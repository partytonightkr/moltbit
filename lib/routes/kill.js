// Kill switch endpoint — the backend for the wizard's "halt the agent instantly,
// positions flattened at market" promise.
//   POST /api/kill  { agentId, reason? }   (operator/depositor session)
//
// Flow (UI → gateway → vault pause → flatten):
//   1. authenticate the caller (any signed-in user can halt; this is a safety brake)
//   2. flip the agent off-chain → status "halted"  (the order gateway now denies it)
//   3. pause the vault on-chain (MoltbitVault.setPaused) — blocks deposits/allocation
//   4. flatten — close venue positions and return capital (mock-safe)
//   5. page ops
// Exits are never blocked, on-chain or off — depositors can always redeem.
import { getCollection, setCollection, STORE_MODE } from "../store.js";
import { safeBody } from "../reqbody.js";
import { requireAuth } from "../auth.js";
import { haltAgent } from "../killSwitch.js";
import { pauseVaultOnchain, flattenOnchain, SERVER_WALLET_MODE } from "../serverWallet.js";
import { alert } from "../alert.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const session = requireAuth(req, res);
  if (!session) return; // 401 already written

  const body = safeBody(req);
  const agentId = body.agentId;
  if (!agentId) { res.status(400).json({ error: "agentId required" }); return; }

  const agents = await getCollection("agents");
  const ai = agents.findIndex((a) => a.id === agentId);
  if (ai < 0) { res.status(404).json({ error: "agent not found" }); return; }
  const agent = agents[ai];

  const by = session.sub || session.user || "operator";
  const reason = body.reason || "manual kill switch";

  // 1. off-chain halt (gateway stops accepting orders immediately)
  agents[ai] = haltAgent(agent, { by, reason });
  await setCollection("agents", agents);

  // 2 + 3. on-chain pause + flatten (mock-safe until server wallet is live)
  const onchain = {};
  try {
    const p = await pauseVaultOnchain({ env: agent.env || "test", vaultAddress: agent.vaultAddress, paused: true });
    onchain.pause = { txHash: p.txHash, mode: p.mode };
  } catch (e) {
    onchain.pause = { error: String(e.message || e) };
  }
  try {
    const f = await flattenOnchain({ env: agent.env || "test", vaultAddress: agent.vaultAddress, venue: agent.venue });
    onchain.flatten = { txHash: f.txHash, mode: f.mode };
  } catch (e) {
    onchain.flatten = { error: String(e.message || e) };
  }

  await alert("agent.kill_switch", { agentId, by, reason, vaultAddress: agent.vaultAddress, onchain }, "error");

  res.status(200).json({
    ok: true,
    agentId,
    status: "halted",
    by,
    reason,
    onchain,
    store: STORE_MODE,
    serverWallet: SERVER_WALLET_MODE,
  });
}
