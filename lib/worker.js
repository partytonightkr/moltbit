// Settlement worker — one epoch of off-chain settlement, driven on a schedule
// by api/cron/settle.js. Pure-ish: takes collections in, returns the next
// collections + a summary. Mirrors lib/settlement.js semantics so the off-chain
// ledger stays in lockstep with the on-chain MoltbitVault windows.
import { strikeDeposit, requestWithdrawal, closeTrades, claim, tick, reconcile } from "./settlement.js";

/**
 * Advance the ledger by wall-clock:
 *   pending deposit      → strike at the agent's current NAV (mint)
 *   settling withdrawal  → closeTrades when the 24h trade-close deadline passes
 *   claimable withdrawal → settle when the 24h claim window elapses
 * Returns { ledger, agents, summary } — caller persists ledger/agents.
 *
 * @param now injectable clock for tests
 */
export function runEpoch(ledgerIn, agents, now = Date.now()) {
  const navOf = (strat) => {
    const a = agents.find((x) => x.id === stratToAgent(strat, agents));
    return a ? Number(a.nav || 1.0) : 1.0;
  };

  // 1. force-close any settling withdrawals whose trade-close deadline passed
  const beforeStatus = new Map(ledgerIn.map((e) => [e.id, e.status]));
  let ledger = tick(ledgerIn, now);
  // count settling → claimable transitions from this tick
  let closed = ledger.filter((e) => beforeStatus.get(e.id) === "settling" && e.status === "claimable").length;

  let struck = 0, settled = 0;

  ledger = ledger.map((e) => {
    // 2. strike pending deposits at current NAV
    if (e.type === "deposit" && e.status === "pending") {
      struck++;
      return strikeDeposit(e, navOf(e.strat));
    }
    // 3. settle claimable withdrawals once the claim window elapses
    if (e.type === "withdrawal" && e.status === "claimable") {
      const out = claim(e, now);
      if (out.status === "settled") { settled++; return out; }
      return e; // window not elapsed yet
    }
    return e;
  });

  const recon = reconcile(agents);
  const open = ledger.filter((e) => e.status === "settling" || e.status === "claimable");

  return {
    ledger,
    agents,
    summary: {
      epoch: now,
      struck,
      closed,
      settled,
      balanced: recon.balanced,
      reconciliation: recon,
      openWindows: open.map((e) => ({
        id: e.id,
        kind: e.status === "settling" ? "trade-close" : "claim",
        msLeft: Math.max(0, (e.closeDeadline || e.claimDeadline || now) - now),
      })),
    },
  };
}

// strategies in seed carry `agent`; ledger entries carry `strat` (strategy id).
function stratToAgent(strat, agents) {
  // best-effort: ledger.strat is a strategy ticker; agents are keyed by id.
  // If you wire strategies collection in, resolve via it. For now match by style/id.
  const direct = agents.find((a) => a.id === strat);
  if (direct) return direct.id;
  // fall back to first agent (demo data) — replace with a real strat→agent map.
  return agents[0] && agents[0].id;
}

// re-export for the request-driven endpoint
export { strikeDeposit, requestWithdrawal, closeTrades, claim };
