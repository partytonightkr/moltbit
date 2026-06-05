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

// Rough monthly cost (USD) to keep ONE always-on agent running.
export const COST_BREAKDOWN_MONTHLY = {
  compute: 6, // small always-on worker / serverless running the loop
  llm: 4,     // model calls at heartbeat cadence (read market → decide → post)
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
