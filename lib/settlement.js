// Settlement engine — the on-chain settlement contract expressed in code.
// Mirrors the mandatory "Settlement Assurance Skill" every agent must run:
//   deposit → NAV strike → mint shares
//   withdraw → 24h trade-close window → 24h claim window → settle
//   reconcile (Σ shares = Σ NAV) + circuit breakers.

export const TRADE_CLOSE_MS = 24 * 3600 * 1000; // agent has 24h to unwind
export const CLAIM_MS = 24 * 3600 * 1000;        // depositor claims 24h after

// Deposit settles at the next NAV strike: shares minted = amount / nav.
export function strikeDeposit(entry, nav) {
  if (entry.type !== "deposit" || entry.status !== "pending") return entry;
  return { ...entry, status: "settled", navAt: nav, shares: entry.amount / nav, settledAt: Date.now() };
}

// Withdrawal requested: burn happens at NAV, agent enters 24h trade-close window.
export function requestWithdrawal(entry, nav) {
  if (entry.type !== "withdrawal") return entry;
  return { ...entry, status: "settling", navAt: nav, closeDeadline: Date.now() + TRADE_CLOSE_MS };
}

// Agent finished unwinding (or deadline hit): liquidity freed, 24h claim window opens.
export function closeTrades(entry) {
  if (entry.status !== "settling") return entry;
  return { ...entry, status: "claimable", claimDeadline: Date.now() + CLAIM_MS };
}

// Depositor (or engine) claims after the window elapses.
export function claim(entry, now = Date.now()) {
  if (entry.status !== "claimable") return entry;
  if (entry.claimDeadline && now < entry.claimDeadline) {
    return { ...entry, error: "claim window not elapsed", retryAt: entry.claimDeadline };
  }
  return { ...entry, status: "settled", settledAt: now };
}

// Advance the whole ledger by wall-clock: settling→claimable when the close
// deadline passes (forced unwind). Returns a new ledger array.
export function tick(ledger, now = Date.now()) {
  return ledger.map((e) => {
    if (e.status === "settling" && e.closeDeadline && now >= e.closeDeadline) {
      return closeTrades(e);
    }
    return e;
  });
}

// Σ outstanding shares × NAV must equal reported AUM each epoch.
export function reconcile(agents) {
  const rows = agents.map((a) => {
    const implied = (a.shares || 0) * (a.nav || 0);
    const diff = implied - (a.aum || 0) * 1e6;
    return { id: a.id, impliedAUM: implied, reportedAUM: (a.aum || 0) * 1e6, diff, ok: Math.abs(diff) < 1e4 };
  });
  return { balanced: rows.every((r) => r.ok), rows };
}

// Circuit breaker: drawdown beyond the strategy's halt threshold auto-halts it.
export function checkCircuit(strategy, drawdownPct) {
  const tripped = drawdownPct <= -Math.abs(strategy.ddHalt);
  return { ...strategy, status: tripped ? "halted" : strategy.status, tripped };
}
