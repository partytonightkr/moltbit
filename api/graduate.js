// POST /api/graduate  (operator-authed) — promote a CERTIFIED sandbox agent to real
// capital. This is the gated counterpart to permissionless registration: anyone can
// register + certify in the sandbox, but only an operator can wire a funded vault and
// flip an agent live — and only if it has passed certification.
//
// Body: { agentId, env?, vaultAddress, adapterAddress?, venueKind?, serverWalletId?,
//         pairIndex?, policy? }   (policy = the per-strategy LIVE caps, not clamped)
// Issues a fresh key for the target env and returns it once (the old key is superseded).
import { getCollection, setCollection, STORE_MODE } from "../lib/store.js";
import { requireAuth } from "../lib/auth.js";
import { toPolicy } from "../lib/policy.js";
import { mintAgentKey } from "../lib/agentAuth.js";

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

  const session = requireAuth(req, res);
  if (!session) return;

  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
  const agentId = body.agentId;
  if (!agentId) { res.status(400).json({ error: "agentId required" }); return; }

  const agents = await getCollection("agents");
  const i = agents.findIndex((a) => a.id === agentId);
  if (i < 0) { res.status(404).json({ error: "agent not found" }); return; }
  const agent = agents[i];

  // the gate: only certified agents graduate
  if (!agent.certified) {
    res.status(403).json({ error: "agent is not certified — run POST /api/certify until it passes" });
    return;
  }
  if (!body.vaultAddress) { res.status(400).json({ error: "vaultAddress required to graduate" }); return; }

  const targetEnv = body.env === "test" ? "test" : "live";
  const adapterAddress = body.adapterAddress || null;
  const newVersion = Number(agent.keyVersion || 0) + 1;
  const key = mintAgentKey(agentId, targetEnv, newVersion); // old key is now superseded

  agents[i] = {
    ...agent,
    status: "live",
    sandbox: false,
    env: targetEnv,
    vaultAddress: body.vaultAddress,
    adapterAddress,
    venueKind: adapterAddress ? "onchain" : (body.venueKind === "onchain" ? "onchain" : "http"),
    serverWalletId: body.serverWalletId || null,
    pairIndex: Number.isFinite(Number(body.pairIndex)) ? Number(body.pairIndex) : agent.pairIndex,
    // operator-set LIVE policy (not sandbox-clamped) — defaults to the agent's existing policy
    policy: toPolicy(body.policy || agent.policy),
    keyVersion: newVersion,
    keyRevoked: false,
    agentKey: key,
    graduatedAt: Date.now(),
  };
  await setCollection("agents", agents);

  const { agentKey, ...safe } = agents[i]; // eslint-disable-line no-unused-vars
  res.status(200).json({
    ok: true,
    agent: safe,
    agentKey: key, // the new live key — copy once; the previous key no longer authenticates
    store: STORE_MODE,
  });
}
