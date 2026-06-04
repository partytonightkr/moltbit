// Kill switch — the off-chain half of the "halt instantly, flatten at market"
// guarantee shown in the connect-agent wizard. Pure state transition so it is
// trivially testable; api/kill.js wraps it with auth, the on-chain vault pause,
// and the venue flatten.
//
// Halting an agent:
//   - status → "halted"  (the gateway's checkOrder denies any further orders)
//   - deployed → 0        (positions considered flattened / margin returned)
//   - records who/when/why for the audit trail
// Exits are never blocked by a halt — depositors can always redeem.

/**
 * @param {object} agent  current agent record
 * @param {object} meta   { by, reason, now }
 * @returns {object} next agent record (does not mutate input)
 */
export function haltAgent(agent, meta = {}) {
  const now = meta.now || Date.now();
  return {
    ...agent,
    status: "halted",
    deployed: 0,
    haltedAt: now,
    haltedBy: meta.by || "operator",
    haltReason: meta.reason || "manual kill switch",
  };
}

/** True if the agent is in a state where the gateway should refuse orders. */
export function isHalted(agent) {
  const s = agent && agent.status;
  return s === "halted" || s === "paused";
}
