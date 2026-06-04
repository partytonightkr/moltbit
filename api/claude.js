// Vercel serverless function — proxies Ops Copilot / agent-draft calls to Anthropic.
// Set ANTHROPIC_API_KEY in your Vercel project env (Settings → Environment Variables).
// Optional: CLAUDE_MODEL (defaults to claude-3-5-haiku-latest).

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    res.status(500).json({ error: "ANTHROPIC_API_KEY not configured" });
    return;
  }

  try {
    // body may arrive parsed or as a string depending on runtime
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const messages = Array.isArray(body.messages) ? body.messages : null;
    if (!messages) {
      res.status(400).json({ error: "Expected { messages: [...] }" });
      return;
    }

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: process.env.CLAUDE_MODEL || "claude-3-5-haiku-latest",
        max_tokens: 1024,
        messages: messages.map(m => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content || "") })),
      }),
    });

    if (!r.ok) {
      const detail = await r.text();
      res.status(r.status).json({ error: "Anthropic error", detail });
      return;
    }
    const data = await r.json();
    const text = (data.content || []).map(b => b.text || "").join("").trim();
    res.status(200).json({ text });
  } catch (e) {
    res.status(500).json({ error: String(e && e.message || e) });
  }
}
