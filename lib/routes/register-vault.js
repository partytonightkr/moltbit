// POST /api/register-vault  (agent key)  { vaultAddress }
//
// Self-service "agent connection": the author deploys their OWN MoltbitVault (they are
// its admin/keeper) and links it here. Moltbit READS THE VAULT ON-CHAIN to confirm it's a
// real, live MoltbitVault before attaching it — then the agent's /agent page reflects live
// NAV/AUM and depositors can deposit into it. Permissionless (your own vault, your own
// funds); operator graduation remains the separate blessed/third-party path.
import { getCollection, setCollection, STORE_MODE } from "../store.js";
import { safeBody } from "../reqbody.js";
import { requireAgent, keyActive } from "../agentAuth.js";
import { readVault } from "../vaultRead.js";

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

  const auth = requireAgent(req, res);
  if (!auth) return;

  const body = safeBody(req);
  const vaultAddress = body.vaultAddress;
  if (!vaultAddress) { res.status(400).json({ error: "vaultAddress required" }); return; }

  const agents = await getCollection("agents");
  const i = agents.findIndex((a) => a.id === auth.agentId);
  if (i < 0) { res.status(404).json({ error: "agent not found" }); return; }
  const agent = agents[i];
  if (!keyActive(agent, auth.kid)) { res.status(401).json({ error: "agent key revoked or superseded" }); return; }

  const env = agent.env || "test";

  // verify on-chain that this is a real, readable MoltbitVault on the agent's env
  let state;
  try {
    state = await readVault({ env, address: vaultAddress });
  } catch (e) {
    res.status(400).json({ error: `couldn't read a MoltbitVault at ${vaultAddress} on ${env}`, reason: String(e.message || e).slice(0, 140) });
    return;
  }
  if (!state) { res.status(400).json({ error: "invalid vault address" }); return; }

  agents[i] = {
    ...agent,
    vaultAddress,
    selfDeployed: true,
    vaultLinkedAt: Date.now(),
    // surface live figures immediately (also re-read live by /agent via /api/vault)
    aum: state.aumM,
    nav: state.nav,
  };
  await setCollection("agents", agents);

  res.status(200).json({
    ok: true,
    agentId: auth.agentId,
    vaultAddress,
    vault: state,
    note: "Vault linked + validated on-chain. Your /agent page now reflects live NAV/AUM. "
      + "Add it to VITE_VAULTS so the Deposit modal mints shares into it.",
    store: STORE_MODE,
  });
}
