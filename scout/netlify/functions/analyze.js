exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  let ingredients, goals, avoids;
  try {
    ({ ingredients, goals, avoids } = JSON.parse(event.body));
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

  const system = `Food ingredient explainer. Output ONLY raw JSON, no markdown/backticks/preamble.
{"ingredients":[{"name":"as written","plain_name":"common name","role":"3-5 word function","explanation":"1 short plain-English sentence","personal_status":"positive|caution|flag|neutral","personal_note":"short note or null","section":"flagged|other"}]}
positive=helps their goals, flag=conflicts with avoid list/goals, caution=worth knowing, neutral=unremarkable. section="flagged" only if personal_status="flag", else "other". Keep parent ingredients whole, don't split parenthetical sub-ingredients. Ignore "contains 2% or less of" phrasing. Be concise. JSON only.`;

  const userMessage = `Here is the ingredient list: ${cleaned}

My health goals: ${goals || "none specified"}.
I am avoiding: ${avoids || "nothing specific"}.`;

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
