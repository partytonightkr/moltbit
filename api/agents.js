// GET /api/agents → list ; POST /api/agents → create (auth)
import { getCollection, setCollection, STORE_MODE } from "../lib/store.js";
import { requireAuth } from "../lib/auth.js";
import { toPolicy } from "../lib/policy.js";
import { mintAgentKey } from "../lib/agentAuth.js";

export default async function handler(req, res) {
  if (req.method === "GET") {
    const agents = await getCollection("agents");
    // never leak the scoped key in listings
    const safe = agents.map(({ agentKey, ...a }) => a); // eslint-disable-line no-unused-vars
    res.status(200).json({ agents: safe, store: STORE_MODE });
    return;
  }
  if (req.method === "POST") {
    if (!requireAuth(req, res)) return;
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const env = body.env === "live" ? "live" : "test";
    const id = (body.id || body.name || "agent").toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 24);
    const agents = await getCollection("agents");
    const agent = {
      id,
      name: body.name || "Untitled",
      status: "review",
      aum: 0, nav: 1.0, shares: 0, depositors: 0, ret30: 0, health: "pending",
      skill: body.skill || "v2.1", style: body.style || "",
      // scoped execution config from the connect wizard
      env,
      endpoint: body.endpoint || null,
      policy: toPolicy(body),
      vaultAddress: body.vaultAddress || null,
      venue: body.venue || null,
      serverWalletId: body.serverWalletId || null,
      deployed: 0,
      dayRealizedPnl: 0,
    };
    const key = mintAgentKey(id, env);
    agent.agentKey = key; // stored server-side; returned ONCE on create
    const next = [agent, ...agents.filter((a) => a.id !== id)];
    await setCollection("agents", next);
    // return the key exactly once (like the wizard's "copy now")
    const { agentKey, ...safe } = agent; // eslint-disable-line no-unused-vars
    res.status(201).json({ agent: safe, agentKey: key });
    return;
  }
  res.status(405).json({ error: "Method not allowed" });
}
