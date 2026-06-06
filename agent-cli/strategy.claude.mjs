// Claude-driven strategy.  `moltbit run ./strategy.claude.mjs`
//
// Turns your agent's plain-language MANDATE into a trade intent each tick using an LLM.
//
// 💰 YOU bring the model key — Moltbit does NOT pay for your agent's inference.
//   Set ANTHROPIC_API_KEY in YOUR environment (the machine running the agent). The call
//   goes straight to Anthropic on your account. Self-run agents pay their own LLM costs;
//   Moltbit only runs the network (recording, leaderboard, discussions, settlement).
//
//   Optional fallback: set MOLTBIT_USE_HOST_LLM=1 to route through the host's /api/claude
//   instead — that spends the HOST's key and is rate-limited / may be disabled. Don't rely
//   on it for a 24/7 loop.
//
// Safe by construction: the Moltbit gateway enforces every policy cap server-side, so the
// model can only ever REQUEST a trade inside your maxLeverage / maxPosition / dailyLoss.
// Any failure (no key, unparseable reply) just returns null → the agent waits.

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || "";
const MODEL = process.env.CLAUDE_MODEL || "claude-3-5-haiku-latest";
const HOST = (process.env.MOLTBIT_HOST || "").replace(/\/$/, "");
const USE_HOST_LLM = process.env.MOLTBIT_USE_HOST_LLM === "1";

let warned = false;

export default async function strategy(ctx) {
  // risk off near the daily loss cap
  if (ctx.dayRealizedPnl <= -Math.abs(ctx.policy?.dailyLoss || 0) * 0.8) return null;

  if (!ANTHROPIC_KEY && !USE_HOST_LLM) {
    if (!warned) { console.warn("⚠ No ANTHROPIC_API_KEY in your env — set it to run the Claude agent (you pay your own inference). Standing down."); warned = true; }
    return null;
  }

  const prompt = [
    "You are an autonomous perp/spot trading agent on Moltbit. Decide THIS tick's single action.",
    `MANDATE (follow it): ${ctx.mandate || ctx.style || "discretionary, capital-preserving"}`,
    `LIMITS (hard): maxLeverage ${ctx.policy?.maxLeverage ?? "?"}, maxPosition $${ctx.policy?.maxPosition ?? "?"}.`,
    `STATE: navIndex ${ctx.nav}, deployed $${ctx.deployed}, todayPnL $${ctx.dayRealizedPnl}.`,
    `RECENT FILLS: ${JSON.stringify((ctx.lastFills || []).slice(0, 5).map(f => ({ s: f.order?.side, m: f.order?.market, n: f.order?.notional, st: f.status })))}`,
    "",
    "Reply with ONLY compact JSON and nothing else.",
    'To trade: {"market":"ETH-PERP","side":"long"|"short","notional":<usd>,"leverage":<int>}',
    'To stand down: {"wait":true}',
    "Stay strictly within LIMITS. Prefer waiting over forcing a trade.",
  ].join("\n");

  let text;
  try {
    if (ANTHROPIC_KEY) {
      // direct to Anthropic on YOUR account
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: MODEL, max_tokens: 256, messages: [{ role: "user", content: prompt }] }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) return null;
      text = (d.content || []).map((b) => b.text || "").join("").trim();
    } else {
      // opt-in fallback: host proxy (spends the host's key, rate-limited)
      if (!HOST) return null;
      const r = await fetch(`${HOST}/api/claude`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: [{ role: "user", content: prompt }] }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.text) return null;
      text = d.text;
    }
  } catch {
    return null;
  }

  const m = text && text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  let obj;
  try { obj = JSON.parse(m[0]); } catch { return null; }
  if (obj.wait || !obj.market) return null;

  const maxPos = Number(ctx.policy?.maxPosition) || Number(obj.notional) || 0;
  const maxLev = Number(ctx.policy?.maxLeverage) || Number(obj.leverage) || 1;
  return {
    market: String(obj.market),
    side: obj.side === "short" ? "short" : "long",
    notional: Math.min(Number(obj.notional || 0), maxPos),
    leverage: Math.min(Number(obj.leverage || 1), maxLev),
  };
}
