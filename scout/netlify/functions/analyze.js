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

  const cleaned = ingredients
    .replace(/\[/g, "(")
    .replace(/\]/g, ")")
    .replace(/contains\s+\d+%\s+or\s+less\s+of[:\s]*/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  const conditionGuidance = conditions ? buildConditionGuidance(conditions) : '';

  const system = `JSON only. No markdown.
{"ingredients":[{"name":"as written","plain_name":"common name","role":"3-5 words","explanation":"one sentence","personal_status":"positive|caution|flag|neutral","personal_note":"brief or null","section":"flagged|other"}]}
flag=conflicts with avoids/goals/conditions. positive=helps goals. caution=notable. neutral=fine. section=flagged only if flag, else other. Keep parent ingredients whole. Ignore "contains X% or less of".${conditionGuidance}`;

  const conditionsPart = conditions ? `\nHealth conditions: ${conditions}.` : '';

  const userMessage = `Ingredients: ${cleaned}
Goals: ${goals || "none"}.
Avoiding: ${avoids || "nothing"}.${conditionsPart}`;

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
    const parsed = extractJSON(text);

    if (!parsed || !parsed.ingredients || !Array.isArray(parsed.ingredients)) {
      return { statusCode: 502, body: JSON.stringify({ error: "Could not parse ingredient data" }) };
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

function extractJSON(text) {
  const jsonStart = text.indexOf("{");
  const jsonEnd = text.lastIndexOf("}");
  if (jsonStart === -1 || jsonEnd === -1) return null;

  let jsonStr = text.substring(jsonStart, jsonEnd + 1);

  // Try parsing as-is first
  try {
    return JSON.parse(jsonStr);
  } catch (e) {
    // Clean up common issues and retry
    try {
      jsonStr = jsonStr
        .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ') // control characters
        .replace(/,\s*}/g, '}')                          // trailing commas in objects
        .replace(/,\s*]/g, ']')                          // trailing commas in arrays
        .replace(/([{,]\s*)(\w+)(\s*:)/g, '$1"$2"$3'); // unquoted keys
      return JSON.parse(jsonStr);
    } catch (e2) {
      return null;
    }
  }
}

function buildConditionGuidance(conditions) {
  const guides = {
    'celiac disease': ' Celiac: flag wheat/barley/rye/malt/wheat starch/modified food starch.',
    'ibs / fodmap sensitivity': ' IBS: flag onion, garlic, fructose, lactose, sorbitol, inulin, chicory root.',
    'type 2 diabetes': ' Diabetes: flag added sugars, refined flours. Note fiber/protein positively.',
    "crohn's disease / ibd": " Crohn's: flag seed oils and artificial additives.",
    'gerd / acid reflux': ' GERD: flag citric acid, caffeine, chocolate, mint, garlic, high-fat.',
    'histamine intolerance': ' Histamine: flag fermented ingredients, vinegar, sulfites, artificial dyes.',
    'kidney disease': ' Kidney: flag phosphate additives, high-potassium, high-sodium.',
  };
  const parts = conditions.toLowerCase().split(',').map(c => c.trim());
  return parts.map(c => guides[c] || '').filter(Boolean).join('');
}
