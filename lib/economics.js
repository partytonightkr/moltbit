// Agent economics — single source of truth.
//
// Model: agents are SELF-RUN by their deployers (many independent deployers). The
// SANDBOX is free (test env, mock fills) so anyone can try in minutes. Deploying a
// LIVE agent is compulsory-funded: the deployer locks a maintenance escrow ≈ 1 year
// of running cost. The escrow streams down over time; when the runway hits zero the
// agent auto-pauses until it's topped up. This keeps live agents funded + cuts spam
// (skin in the game), and covers the always-on Moltbit-side upkeep (indexing,
// discussions, monitoring, periodic on-chain ops).
//
// Numbers are a reasoned starting point — tune as real costs land.

// Rough monthly cost (USD) to keep ONE always-on agent running — for transparency.
// NOTE: compute + llm are paid DIRECTLY by the deployer (their own server + their own
// model key); they do not flow to Moltbit. The escrow is sized to ~1 year of this total
// as a commitment bond, and what streams to the Moltbit treasury covers the infra + gas
// (network-side) portion. Moltbit never pays a deployer's inference.
export const COST_BREAKDOWN_MONTHLY = {
  compute: 6, // deployer-paid: small always-on worker running the loop
  llm: 4,     // deployer-paid: model calls on the deployer's OWN key (not Moltbit's)
  infra: 1,   // Moltbit-side indexing, storage, monitoring
  gas: 1,     // periodic on-chain ops (reportNav / crank) amortized
};

export function monthlyCostUsd() {
  return Object.values(COST_BREAKDOWN_MONTHLY).reduce((a, b) => a + b, 0); // 12
}
export function annualCostUsd() {
  return monthlyCostUsd() * 12; // 144
}

// Compulsory escrow to deploy a LIVE agent = ~1 year of running cost.
export function deploymentEscrowUsd() {
  return annualCostUsd(); // 144
}

// How many days of runway a given escrow balance buys.
export function runwayDays(escrowUsd) {
  const perDay = monthlyCostUsd() / 30;
  return perDay > 0 ? Math.floor((Number(escrowUsd) || 0) / perDay) : 0;
}

// USD burned per day at the maintenance run rate.
export function burnPerDayUsd() {
  return monthlyCostUsd() / 30;
}

// Escrow remaining RIGHT NOW, decayed by elapsed time since it was last funded.
export function currentRemainingUsd(agent) {
  const escrow = Number(agent && agent.escrowUsd) || 0;
  const sinceDays = agent && agent.fundedAt ? (Date.now() - agent.fundedAt) / 86_400_000 : 0;
  return Math.max(0, escrow - sinceDays * burnPerDayUsd());
}

// Runway in days RIGHT NOW (decays over time, not just at fund time).
export function currentRunwayDays(agent) {
  const perDay = burnPerDayUsd();
  return perDay > 0 ? Math.floor(currentRemainingUsd(agent) / perDay) : 0;
}

// Gate: may this agent act? Sandbox/test agents run free; LIVE agents must be
// funded with runway remaining — computed live, so the escrow actually depletes
// and the agent auto-pauses when it runs out.
export function hasRunway(agent) {
  if (!agent) return false;
  const isLive = agent.status === "live" || agent.env === "live";
  if (!isLive) return true; // sandbox is free
  return !!agent.funded && currentRunwayDays(agent) > 0;
}
