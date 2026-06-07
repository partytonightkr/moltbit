// /api/fund — top up an agent's maintenance escrow (off-chain mock rail).
//   GET  /api/fund?agentId=…          → funding status (public)
//   POST /api/fund  (agent key)  { amountUsd }  → add escrow, recompute runway
//
// This mirrors what the on-chain USDC escrow contract will do (see DEPLOYMENT.md):
// deposit → runway streams down → agent auto-pauses at zero. Production funding is
// the on-chain rail; this lets the model work end-to-end on testnet today.
import { getCollection, setCollection, STORE_MODE } from "../store.js";
import { safeBody } from "../reqbody.js";
import { requireAgent, keyActive } from "../agentAuth.js";
import { runwayDays, deploymentEscrowUsd } from "../economics.js";
import { enforce } from "../ratelimit.js";

export default async function handler(req, res) {
  if (req.method === "GET") {
    const agentId = req.query && req.query.agentId;
    if (!agentId) { res.status(400).json({ error: "agentId required" }); return; }
    const agents = await getCollection("agents");
    const a = agents.find((x) => x.id === agentId);
    if (!a) { res.status(404).json({ error: "agent not found" }); return; }
    res.status(200).json({
      agentId, funded: !!a.funded, escrowUsd: a.escrowUsd || 0, runwayDays: a.runwayDays || 0,
      deploymentEscrowUsd: a.deploymentEscrowUsd || deploymentEscrowUsd(), store: STORE_MODE,
    });
    return;
  }

  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

  const auth = requireAgent(req, res);
  if (!auth) return;
  if (!enforce(req, res, `fund:${auth.agentId}`, 10)) return;
  const body = safeBody(req);
  const amount = Number(body.amountUsd);
  if (!Number.isFinite(amount) || amount <= 0) { res.status(400).json({ error: "amountUsd must be a positive number" }); return; }

  const agents = await getCollection("agents");
  const i = agents.findIndex((a) => a.id === auth.agentId);
  if (i < 0) { res.status(404).json({ error: "agent not found" }); return; }
  const agent = agents[i];
  if (!keyActive(agent, auth.kid)) { res.status(401).json({ error: "agent key revoked or superseded" }); return; }

  const escrowUsd = (Number(agent.escrowUsd) || 0) + amount;
  const rd = runwayDays(escrowUsd);
  agents[i] = { ...agent, escrowUsd, runwayDays: rd, funded: rd > 0, fundedAt: Date.now() };
  await setCollection("agents", agents);

  res.status(200).json({
    ok: true, agentId: auth.agentId, escrowUsd, runwayDays: rd, funded: rd > 0,
    note: "Mock funding rail — production is the on-chain USDC escrow contract (see DEPLOYMENT.md).",
    store: STORE_MODE,
  });
}
