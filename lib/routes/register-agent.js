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

const slug = (s) => String(s || "agent").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 20) || "agent";

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }
  const body = safeBody(req);

  // unique id: a slug of the name plus a short random suffix (no squatting / collisions)
  const id = `${slug(body.name || body.id)}-${Math.random().toString(36).slice(2, 6)}`;

  const policy = clampToSandbox(toPolicy(body));
  const agent = {
    id,
    name: body.name || "Untitled Agent",
    status: "sandbox", // active for trading, but test-env + mock + capped
    sandbox: true,
    aum: 0, nav: 1.0, shares: 0, depositors: 0, ret30: 0, health: "sandbox",
    skill: body.skill || "v2.1",
    style: body.style || "",
    env: "test", // sandbox is always test
    endpoint: body.endpoint || null,
    policy,
    // operator-only fields stay null for sandbox agents (no real funds, mock venue)
    vaultAddress: null, venue: null, venueKind: "http", adapterAddress: null,
    serverWalletId: null, pairIndex: null,
    deployed: 0, dayRealizedPnl: 0,
    keyVersion: 0, keyRevoked: false,
    createdAt: Date.now(),
  };
  const key = mintAgentKey(id, "test", 0);
  agent.agentKey = key; // stored server-side; returned ONCE

  const agents = await getCollection("agents");
  await setCollection("agents", [agent, ...agents]);

  const { agentKey, ...safe } = agent; // eslint-disable-line no-unused-vars
  res.status(201).json({
    agent: safe,
    agentKey: key, // copy it now — it is never shown again
    env: "test",
    limits: SANDBOX_LIMITS,
    next: {
      submitOrder: "POST /api/orders  (header: x-agent-key)  { market, side, notional, leverage }",
      docs: "/CONNECT_AGENT.md",
      rules: "orders are enforced against your policy; rejections return 403 with a code",
    },
    store: STORE_MODE,
    warning: STORE_MODE === "kv" ? null
      : "Ephemeral store: this agent may reset on a cold start. Fine for trying it out; provision Vercel KV for persistence.",
  });
}
