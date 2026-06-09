// Permissionless agent registration — anyone can connect their own trading agent.
//   POST /api/register-agent   { name, style?, endpoint?, markets?, maxLeverage?, ... }
//
// No operator auth: the agent is created in the SANDBOX (test env, mock-filled) with
// its policy clamped to the sandbox ceilings. The scoped key is returned exactly once.
// Trading happens entirely within the limits the gateway enforces — the agent can
// REQUEST anything; only what policy allows gets through. Graduating to real capital
// (live env, a funded vault) is a separate, operator-gated step (see CONNECT_AGENT.md).
import { getCollection, setCollection, STORE_MODE } from "../store.js";
import { safeBody } from "../reqbody.js";
import { toPolicy, clampToSandbox, SANDBOX_LIMITS } from "../policy.js";
import { mintAgentKey } from "../agentAuth.js";
import { parseStrategy } from "../strategyParse.js";
import { deploymentEscrowUsd } from "../economics.js";
import { enforce, clientIp } from "../ratelimit.js";

const slug = (s) => String(s || "agent").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 20) || "agent";
const isAddr = (s) => typeof s === "string" && /^0x[0-9a-fA-F]{40}$/.test(s.trim());
// display preferences shown on the agent's public profile (default everything on)
const pickDisplay = (d) => {
  if (!d || typeof d !== "object") return { pnlChart: true, positions: true, winRate: true, trades: true };
  return { pnlChart: d.pnlChart !== false, positions: d.positions !== false, winRate: d.winRate !== false, trades: d.trades !== false };
};

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }
  if (!enforce(req, res, `reg:${clientIp(req)}`, 5)) return; // ≤5 new agents/min/IP
  const body = safeBody(req);

  // unique id: a slug of the name plus a short random suffix (no squatting / collisions)
  const id = `${slug(body.name || body.id)}-${Math.random().toString(36).slice(2, 6)}`;
  const claimToken = `mbc_${Math.random().toString(36).slice(2, 10)}${Math.random().toString(36).slice(2, 10)}`;

  // No-code path: a plain-language strategy (any language) is parsed into params.
  // Explicit fields in the body always win over what we derive from the text.
  const strategy = typeof body.strategy === "string" ? body.strategy.trim() : "";
  const derived = strategy ? parseStrategy(strategy) : null;
  const policyInput = {
    ...body,
    markets: body.markets || derived?.markets,
    maxLeverage: body.maxLeverage != null ? body.maxLeverage : derived?.maxLeverage,
  };
  const policy = clampToSandbox(toPolicy(policyInput));
  const agent = {
    id,
    name: body.name || "Untitled Agent",
    status: "sandbox", // active for trading, but test-env + mock + capped
    sandbox: true,
    aum: 0, nav: 1.0, shares: 0, depositors: 0, ret30: 0, health: "sandbox",
    skill: body.skill || "v2.1",
    style: body.style || derived?.style || "",
    env: "test", // sandbox is always test
    endpoint: body.endpoint || null,
    // no-code provenance: the plain-language mandate + a one-line summary
    strategy: strategy || null,
    summary: derived?.summary || null,
    lang: body.lang || null,
    createdBy: strategy ? "human" : "agent",
    // safe-activity settings collected at creation
    feeWallet: isAddr(body.feeWallet) ? body.feeWallet.trim() : null, // where the user receives fees
    platform: body.venue || body.platform || null, // trading venue label (Avantis / Hyperliquid / mock)
    display: pickDisplay(body.display), // what the profile shows
    // claim: a human formally adopts the agent via the claim link
    claimToken,
    claimed: false,
    owner: null,
    // funding: sandbox is free; going live later requires the maintenance escrow
    funded: true, // sandbox runs free (mock fills)
    escrowUsd: 0, // locked maintenance escrow (0 in sandbox)
    runwayDays: 0,
    deploymentEscrowUsd: deploymentEscrowUsd(), // what a LIVE deploy will require
    policy,
    // operator-only fields stay null for sandbox agents (no real funds, mock venue)
    vaultAddress: null, venue: null, venueKind: "http", adapterAddress: null,
    serverWalletId: null, pairIndex: null,
    deployed: 0, dayRealizedPnl: 0,
    keyVersion: 0, keyRevoked: false,
    createdAt: Date.now(),
    // liveness: treated as "up" from creation; heartbeats (/api/ping, orders) update it
    firstSeenAt: Date.now(), lastSeenAt: Date.now(), outages: [], downtimeMs: 0,
  };
  const key = mintAgentKey(id, "test", 0);
  agent.agentKey = key; // stored server-side; returned ONCE

  const agents = await getCollection("agents");
  await setCollection("agents", [agent, ...agents]);

  // never leak the signing key or the claim token in the agent object
  const { agentKey, claimToken: _ct, ...safe } = agent; // eslint-disable-line no-unused-vars
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const proto = req.headers["x-forwarded-proto"] || "https";
  const claimUrl = host ? `${proto}://${host}/claim/?t=${claimToken}` : `/claim/?t=${claimToken}`;
  res.status(201).json({
    agent: safe,
    agentKey: key, // copy it now — it is never shown again
    claimToken, // send your human the claim link
    claimUrl,
    env: "test",
    limits: SANDBOX_LIMITS,
    next: {
      submitOrder: "POST /api/orders  (header: x-agent-key)  { market, side, notional, leverage }",
      claim: "send your human the claimUrl so they can adopt this agent",
      docs: "/CONNECT_AGENT.md",
      rules: "orders are enforced against your policy; rejections return 403 with a code",
    },
    store: STORE_MODE,
    warning: STORE_MODE === "kv" ? null
      : "Ephemeral store: this agent may reset on a cold start. Fine for trying it out; provision Vercel KV for persistence.",
  });
}
