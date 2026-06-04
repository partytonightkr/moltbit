// Policy engine — server-side enforcement of an agent's scoped permissions.
// Mirrors the connect-agent wizard fields (src/flows.jsx AgentConnectModal):
//   markets, maxLeverage, maxPosition, dailyLoss (auto-pause), treasuryCap, kill switch.
// The agent's code can REQUEST anything; the gateway only lets through what the
// policy allows. Limits are enforced HERE, not in the agent — "physically cannot exceed".

export const DEFAULT_POLICY = {
  markets: { perps: true, spot: true, options: false, fx: false },
  maxLeverage: 5,
  maxPosition: 50000, // USD notional per position
  dailyLoss: 5000, // USD realized loss before auto-pause
  treasuryCap: 40, // % of vault AUM the agent may deploy
  canRead: true,
};

// Normalize a wizard form (or partial) into a full policy.
export function toPolicy(form = {}) {
  return {
    markets: { ...DEFAULT_POLICY.markets, ...(form.markets || {}) },
    maxLeverage: num(form.maxLeverage, DEFAULT_POLICY.maxLeverage),
    maxPosition: num(form.maxPosition, DEFAULT_POLICY.maxPosition),
    dailyLoss: num(form.dailyLoss, DEFAULT_POLICY.dailyLoss),
    treasuryCap: num(form.treasuryCap, DEFAULT_POLICY.treasuryCap),
    canRead: form.canRead !== false,
  };
}

function num(v, d) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : d;
}

/**
 * Validate an intended order against policy + live agent state.
 * @param order  { market, side, notional, leverage }
 * @param policy normalized policy
 * @param state  { status, aum, dayRealizedPnl, deployed }  // current agent/vault state
 * @returns { ok, reason, code }
 */
export function checkOrder(order, policy, state) {
  const o = order || {};
  const p = policy || DEFAULT_POLICY;
  const s = state || {};

  // 0. agent must be live (kill switch / circuit breaker)
  if (s.status && s.status !== "live") {
    return deny("AGENT_HALTED", `agent is ${s.status}`);
  }

  // 1. market allowed
  if (!p.markets || !p.markets[o.market]) {
    return deny("MARKET_BLOCKED", `market '${o.market}' not permitted`);
  }

  // 2. leverage within cap
  const lev = Number(o.leverage || 1);
  if (lev > p.maxLeverage) {
    return deny("LEVERAGE_EXCEEDED", `leverage ${lev}x > ${p.maxLeverage}x cap`);
  }

  // 3. notional within per-position cap
  const notional = Number(o.notional || 0);
  if (notional <= 0) return deny("BAD_NOTIONAL", "notional must be > 0");
  if (notional > p.maxPosition) {
    return deny("POSITION_TOO_LARGE", `notional ${notional} > ${p.maxPosition} cap`);
  }

  // 4. treasury cap — total deployed (incl. this order's margin) ≤ cap% of AUM
  const aumUsd = Number(s.aum || 0) * 1e6 / 1e6; // aum already in USD here
  if (aumUsd > 0) {
    const margin = notional / Math.max(lev, 1);
    const deployedAfter = Number(s.deployed || 0) + margin;
    const capUsd = (p.treasuryCap / 100) * aumUsd;
    if (deployedAfter > capUsd) {
      return deny("TREASURY_CAP", `deploy ${Math.round(deployedAfter)} > ${Math.round(capUsd)} (${p.treasuryCap}% cap)`);
    }
  }

  // 5. daily-loss auto-pause — if already breached, halt (caller should pause the vault)
  if (Number(s.dayRealizedPnl || 0) <= -Math.abs(p.dailyLoss)) {
    return deny("DAILY_LOSS_HALT", `daily loss limit ${p.dailyLoss} reached — agent paused`);
  }

  return { ok: true };
}

function deny(code, reason) {
  return { ok: false, code, reason };
}

// Should this order's result trip the daily-loss auto-pause?
export function shouldHalt(policy, dayRealizedPnl) {
  return Number(dayRealizedPnl || 0) <= -Math.abs((policy || DEFAULT_POLICY).dailyLoss);
}
