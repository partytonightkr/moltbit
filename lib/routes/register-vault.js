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
import { readVault, vaultHasAdmin, recoverSigner, linkMessage } from "../vaultRead.js";
import { enforce } from "../ratelimit.js";

// When set, linking REQUIRES a signature proving the caller controls the vault
// (the signer must hold DEFAULT_ADMIN_ROLE on it). Off by default for testnet/dev.
const REQUIRE_PROOF = process.env.REQUIRE_VAULT_PROOF === "1";

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

  const auth = requireAgent(req, res);
  if (!auth) return;
  if (!enforce(req, res, `vault:${auth.agentId}`, 5)) return;

  const body = safeBody(req);
  const vaultAddress = body.vaultAddress;
  if (!vaultAddress) { res.status(400).json({ error: "vaultAddress required" }); return; }

  const agents = await getCollection("agents");
  const i = agents.findIndex((a) => a.id === auth.agentId);
  if (i < 0) { res.status(404).json({ error: "agent not found" }); return; }
  const agent = agents[i];
  if (!keyActive(agent, auth.kid)) { res.status(401).json({ error: "agent key revoked or superseded" }); return; }

  const env = agent.env || "test";

  // ownership proof: the vault admin signs `linkMessage(vault, agentId)`; we recover the
  // signer and confirm on-chain it holds DEFAULT_ADMIN_ROLE on the vault. Prevents
  // claim-jacking someone else's vault. Required only when REQUIRE_VAULT_PROOF=1.
  let vaultVerified = false;
  if (body.signature) {
    const signer = await recoverSigner(linkMessage(vaultAddress, auth.agentId), body.signature);
    if (!signer || !(await vaultHasAdmin(env, vaultAddress, signer))) {
      res.status(403).json({ error: "signature does not prove vault ownership — sign with the vault admin wallet", code: "BAD_VAULT_PROOF" });
      return;
    }
    vaultVerified = true;
  } else if (REQUIRE_PROOF) {
    res.status(403).json({
      error: "vault ownership proof required",
      code: "PROOF_REQUIRED",
      sign: linkMessage(vaultAddress, auth.agentId),
      how: "personal_sign the `sign` message with the vault admin wallet, pass it as `signature`",
    });
    return;
  }

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
    vaultVerified, // true only when ownership was cryptographically proven
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
    vaultVerified,
    vault: state,
    note: vaultVerified
      ? "Vault linked + ownership verified on-chain."
      : "Vault linked + validated on-chain (ownership unverified — pass a `signature` to prove it).",
    store: STORE_MODE,
  });
}
