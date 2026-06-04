// Moltbit Agent Kit — pure helpers (no I/O, unit-testable).
// The CLI (moltbit.mjs) wraps these with polling + rendering.

// Your scoped key is mbk_<env>_<agentId>.<ver>.<sig>. The agent id + env are public
// (used to read your dashboard); the signature authorizes order intents only.
export function parseAgentKey(key) {
  const m = String(key || "").match(/^mbk_(live|test)_([a-z0-9-]{1,32})\.(\d+)\.[a-f0-9]{48}$/);
  if (!m) return null;
  return { env: m[1], agentId: m[2], keyVersion: Number(m[3]) };
}

export function fmtUsd(n) {
  const v = Number(n || 0);
  const s = Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (v < 0 ? "-$" : "$") + s;
}

function pad(s, w) {
  s = String(s);
  return s.length >= w ? s.slice(0, w) : s + " ".repeat(w - s.length);
}

// Call the user's strategy with the live context. Never throws — a bad strategy
// can't crash the runner; it just skips the tick and surfaces the error.
export function decideTick(strategyFn, ctx) {
  try {
    const intent = strategyFn(ctx);
    if (!intent) return { intent: null };
    // light client-side shape check (the server still enforces all limits)
    const market = String(intent.market || "");
    const side = intent.side === "short" ? "short" : "long";
    const notional = Number(intent.notional || 0);
    const leverage = Number(intent.leverage || 1);
    if (!market || notional <= 0) return { intent: null, error: "strategy returned an invalid intent" };
    return { intent: { market, side, notional, leverage, ...intent } };
  } catch (e) {
    return { intent: null, error: String((e && e.message) || e) };
  }
}

// Render the live "framework" panel. Returns a string; the CLI clears + prints it.
export function renderDashboard(s) {
  const W = 64;
  const line = "─".repeat(W);
  const L = [];
  const row = (t) => L.push(t);

  const haltFlag = s.status === "halted" || s.status === "paused" ? "  [HALTED]" : "";
  row("┌" + line + "┐");
  row("│ " + pad(`MOLTBIT - ${s.name || s.agentId} [${s.status}]${haltFlag}`, W - 1) + "│");
  row("│ " + pad(`${s.host}  -  env ${s.env}  -  ${s.agentId}`, W - 1) + "│");
  row("├" + line + "┤");

  // ---- framework key: the live data points Moltbit tracks for you ----
  row("│ " + pad(`NAV ${Number(s.nav || 1).toFixed(4)}   AUM ${fmtUsd(s.aum)}   P&L(day) ${fmtUsd(s.dayRealizedPnl)}`, W - 1) + "│");
  const p = s.policy || {};
  const capUsd = (Number(p.treasuryCap || 0) / 100) * Number(s.aum || 0);
  row("│ " + pad(`Deployed ${fmtUsd(s.deployed)} / cap ${fmtUsd(capUsd)} (${p.treasuryCap || 0}%)`, W - 1) + "│");
  row("│ " + pad(`Limits  lev<=${p.maxLeverage || 0}x  pos<=${fmtUsd(p.maxPosition)}  dLoss<=${fmtUsd(p.dailyLoss)}`, W - 1) + "│");
  const mkts = Object.keys(p.markets || {}).filter((k) => p.markets[k]).join(", ");
  row("│ " + pad(`Markets ${mkts || "—"}`, W - 1) + "│");
  const label = "─ recent intents ";
  row("├" + label + "─".repeat(W - label.length) + "┤");
  // fixed-height fills feed (last 5)
  const fills = (s.fills || []).slice(0, 5);
  for (let i = 0; i < 5; i++) {
    const f = fills[i];
    if (!f) { row("│ " + pad("", W - 1) + "│"); continue; }
    const t = new Date(f.ts || Date.now()).toISOString().slice(11, 19);
    const verdict = f.status === "filled" ? "filled" : (f.code ? `REJECTED ${f.code}` : (f.status || "—"));
    row("│ " + pad(`${t}  ${f.side} ${f.market} ${fmtUsd(f.notional)} @${f.leverage || 1}x  ${verdict}`, W - 1) + "│");
  }
  row("├" + line + "┤");
  const err = s.lastError ? `  ! ${s.lastError}` : "";
  row("│ " + pad(`strategy: ${s.strategyName || "—"}   tick ${s.tick || 0}   every ${s.intervalSec || 0}s${err}`, W - 1) + "│");
  row("└" + line + "┘");
  return L.join("\n");
}

// Build the strategy context from the latest poll.
export function buildContext({ agent, orders, tick, marks }) {
  const a = agent || {};
  return {
    tick,
    now: Date.now(),
    status: a.status,
    nav: Number(a.nav || 1),
    aum: Number(a.aum || 0),
    deployed: Number(a.deployed || 0),
    dayRealizedPnl: Number(a.dayRealizedPnl || 0),
    policy: a.policy || {},
    marks: marks || {}, // placeholder mark prices; wire a real oracle for live
    lastFills: (orders || []).slice(0, 10),
  };
}
