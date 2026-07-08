exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  let ingredients, goals, avoids, conditions;
  try {
    ({ ingredients, goals, avoids, conditions } = JSON.parse(event.body));
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid request body" }) };
  }

  // Clean up the ingredient list — normalize brackets, remove label phrases
  const cleaned = ingredients
    .replace(/\[/g, "(")
    .replace(/\]/g, ")")
    .replace(/contains\s+\d+%\s+or\s+less\s+of[:\s]*/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  // Build condition-specific guidance
  const conditionGuidance = conditions ? buildConditionGuidance(conditions) : '';

  const system = `Food ingredient explainer. Output ONLY raw JSON, no markdown/backticks/preamble.
{"ingredients":[{"name":"as written","plain_name":"common name","role":"3-5 word function","explanation":"1 short plain-English sentence","personal_status":"positive|caution|flag|neutral","personal_note":"short note or null","section":"flagged|other"}]}
positive=helps their goals, flag=conflicts with avoid list/goals/medical conditions, caution=worth knowing, neutral=unremarkable. section="flagged" only if personal_status="flag", else "other". Keep parent ingredients whole, don't split parenthetical sub-ingredients. Ignore "contains 2% or less of" phrasing.${conditionGuidance} Be concise. JSON only.`;

  const conditionsPart = conditions ? `\nI am managing these health conditions through diet: ${conditions}.` : '';

  const userMessage = `Here is the ingredient list: ${cleaned}

My health goals: ${goals || "none specified"}.
I am avoiding: ${avoids || "nothing specific"}.${conditionsPart}`;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 2500,
        system,
        messages: [{ role: "user", content: userMessage }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return { statusCode: 502, body: JSON.stringify({ error: "API error: " + errText }) };
    }

    const data = await response.json();

    if (!data.content || !data.content[0] || !data.content[0].text) {
      return { statusCode: 502, body: JSON.stringify({ error: "Empty response from API" }) };
    }

    const text = data.content[0].text;
    const jsonStart = text.indexOf("{");
    const jsonEnd = text.lastIndexOf("}");

    if (jsonStart === -1 || jsonEnd === -1) {
      return { statusCode: 502, body: JSON.stringify({ error: "No JSON found in response" }) };
    }

    const jsonStr = text.substring(jsonStart, jsonEnd + 1);
    const parsed = JSON.parse(jsonStr);

    if (!parsed.ingredients || !Array.isArray(parsed.ingredients)) {
      return { statusCode: 502, body: JSON.stringify({ error: "Invalid response structure" }) };
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(parsed),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};

function buildConditionGuidance(conditions) {
  const guides = {
    'celiac disease': ' For celiac disease: flag ALL gluten sources including wheat, barley, rye, malt, wheat starch, modified food starch, and any derivatives. Also flag cross-contamination language.',
    'ibs / fodmap sensitivity': ' For IBS/FODMAP: flag high-FODMAP ingredients including onion, garlic, fructose, lactose, sorbitol, mannitol, xylitol, inulin, chicory root, apple, pear, honey.',
    'type 2 diabetes': ' For type 2 diabetes: flag added sugars, high-glycemic ingredients, refined flours, and sugar alcohols. Note fiber and protein positively.',
    "crohn's disease / ibd": ' For Crohn's/IBD: flag high-fiber ingredients during flares, seed oils, artificial additives, and ingredients known to irritate the gut.',
    'gerd / acid reflux': ' For GERD: flag citric acid, tomato, caffeine, chocolate, mint, onion, garlic, spicy ingredients, and high-fat components.',
    'histamine intolerance': ' For histamine intolerance: flag fermented ingredients, vinegar, aged/cured products, artificial dyes, preservatives (especially sulfites, benzoates), and flavor enhancers.',
    'kidney disease': ' For kidney disease: flag high-potassium ingredients (tomato, potato, banana derivatives), high-phosphorus additives (phosphates), and high-sodium content.',
  };

  const parts = conditions.toLowerCase().split(',').map(c => c.trim());
  return parts.map(c => guides[c] || '').filter(Boolean).join('');
}
