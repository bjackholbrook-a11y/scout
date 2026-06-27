exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const { ingredients, goals, avoids } = JSON.parse(event.body);

  const system = `You are a food science explainer for Scout. The user will provide a food ingredient list and their personal health profile. Return ONLY a raw JSON object with no markdown, no backticks, no preamble. Structure:
{"ingredients":[{"name":"ingredient name as written","plain_name":"common name","role":"function in food, 3-5 words","explanation":"1-2 plain English sentences","personal_status":"positive|caution|flag|neutral","personal_note":"short note relevant to their goals, or null","section":"flagged|other"}]}

Status rules:
- positive: works toward their stated goals
- flag: conflicts with their avoid list or goals  
- caution: worth being aware of
- neutral: unremarkable

Section is "flagged" if personal_status is "flag", otherwise "other".
Keep parent ingredients whole — do not split sub-ingredients in parentheses into separate entries.
Return only the JSON object, nothing else.`;

  const userMessage = `Here is the ingredient list: ${ingredients}

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
        max_tokens: 2000,
        system,
        messages: [{ role: "user", content: userMessage }],
      }),
    });

    const data = await response.json();
    const text = data.content[0].text;

    const jsonStart = text.indexOf("{");
    const jsonEnd = text.lastIndexOf("}");
    const jsonStr = text.substring(jsonStart, jsonEnd + 1);
    const parsed = JSON.parse(jsonStr);

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
