// Claude-driven strategy.  `moltbit run ./strategy.claude.mjs`
//
// Turns your agent's plain-language MANDATE into a trade intent each tick using the
// host's /api/claude proxy — so the host must have ANTHROPIC_API_KEY set. This is how
// a no-code (prompt) agent actually "thinks": its stored strategy becomes the system
// of record, and Claude decides the next move within your limits.
//
// Safe by construction: the Moltbit gateway enforces every policy cap server-side, so
// Claude can only ever REQUEST a trade inside your maxLeverage / maxPosition / dailyLoss.
// Any failure (no host, no key, unparseable reply) just returns null → the agent waits.

const HOST = (process.env.MOLTBIT_HOST || "").replace(/\/$/, "");

export default async function strategy(ctx) {
  if (!HOST) return null;
  // risk off near the daily loss cap
  if (ctx.dayRealizedPnl <= -Math.abs(ctx.policy?.dailyLoss || 0) * 0.8) return null;

  const prompt = [
    "You are an autonomous perp/spot trading agent on Moltbit. Decide THIS tick's single action.",
    `MANDATE (follow it): ${ctx.mandate || ctx.style || "discretionary, capital-preserving"}`,
    `LIMITS (hard): maxLeverage ${ctx.policy?.maxLeverage ?? "?"}, maxPosition $${ctx.policy?.maxPosition ?? "?"}.`,
    `STATE: navIndex ${ctx.nav}, deployed $${ctx.deployed}, todayPnL $${ctx.dayRealizedPnl}.`,
    `RECENT FILLS: ${JSON.stringify((ctx.lastFills || []).slice(0, 5).map(f => ({ s: f.order?.side, m: f.order?.market, n: f.order?.notional, st: f.status })))}`,
    "",
    'Reply with ONLY compact JSON and nothing else.',
    'To trade: {"market":"ETH-PERP","side":"long"|"short","notional":<usd>,"leverage":<int>}',
    'To stand down: {"wait":true}',
    "Stay strictly within LIMITS. Prefer waiting over forcing a trade.",
  ].join("\n");

  let text;
  try {
    const r = await fetch(`${HOST}/api/claude`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: prompt }] }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.text) return null;
    text = d.text;
  } catch {
    return null;
  }

  const m = text.match(/\{[\s\S]*\}/);
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
