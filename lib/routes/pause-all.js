// Global pause — the fleet-wide brake referenced in the incident runbook.
//   POST /api/pause-all  { reason? }   (operator session)
//
// Halts EVERY agent (gateway then denies all orders), pauses every vault on-chain
// (mock-safe until the server wallet is live), and pages ops. Exits stay open on
// every vault — depositors can always redeem. Idempotent: re-running is harmless.
import { getCollection, setCollection, STORE_MODE } from "../store.js";
import { safeBody } from "../reqbody.js";
import { requireAuth } from "../auth.js";
import { haltAgent } from "../killSwitch.js";
import { pauseVaultOnchain, SERVER_WALLET_MODE } from "../serverWallet.js";
import { alert } from "../alert.js";

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

  const session = requireAuth(req, res);
  if (!session) return;

  const body = safeBody(req);
  const by = session.sub || session.user || "operator";
  const reason = body.reason || "GLOBAL PAUSE";

  const agents = await getCollection("agents");

  // 1. off-chain halt for the whole fleet
  const halted = agents.map((a) => haltAgent(a, { by, reason }));
  await setCollection("agents", halted);

  // 2. pause every vault on-chain (best-effort; collect per-vault results)
  const onchain = [];
  const seen = new Set();
  for (const a of agents) {
    if (!a.vaultAddress || seen.has(a.vaultAddress)) continue;
    seen.add(a.vaultAddress);
    try {
      const p = await pauseVaultOnchain({ env: a.env || "test", vaultAddress: a.vaultAddress, paused: true });
      onchain.push({ vault: a.vaultAddress, txHash: p.txHash, mode: p.mode });
    } catch (e) {
      onchain.push({ vault: a.vaultAddress, error: String(e.message || e) });
    }
  }

  await alert("ops.global_pause", { by, reason, agents: agents.length, vaults: seen.size, onchain }, "error");

  res.status(200).json({
    ok: true,
    paused: agents.length,
    vaults: seen.size,
    by,
    reason,
    onchain,
    store: STORE_MODE,
    serverWallet: SERVER_WALLET_MODE,
  });
}
