// /api/claim — a human formally adopts (claims) an agent via its claim link.
//   GET  /api/claim?token=mbc_…           → preview the agent to adopt (no secrets)
//   POST /api/claim  { token, owner }       → mark claimed, record the owner
//
// The claim token is a capability: whoever holds the link can adopt the agent once.
// It is never exposed in public listings; only the creator receives it at registration.
import { getCollection, setCollection, STORE_MODE } from "../store.js";
import { safeBody } from "../reqbody.js";

const pub = (a) => ({ id: a.id, name: a.name, style: a.style, summary: a.summary, createdAt: a.createdAt });

export default async function handler(req, res) {
  const token = (req.query && req.query.token) || (req.method === "POST" ? safeBody(req).token : null);
  if (!token) { res.status(400).json({ error: "token required" }); return; }

  const agents = await getCollection("agents");
  const i = agents.findIndex((a) => a.claimToken === token);
  if (i < 0) { res.status(404).json({ error: "invalid or expired claim link" }); return; }
  const agent = agents[i];

  if (req.method === "GET") {
    res.status(200).json({ agent: pub(agent), claimed: !!agent.claimed, owner: agent.owner || null, store: STORE_MODE });
    return;
  }

  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

  if (agent.claimed) { res.status(409).json({ error: "agent already claimed", owner: agent.owner || null }); return; }

  const body = safeBody(req);
  const owner = typeof body.owner === "string" ? body.owner.trim().slice(0, 80) : "";
  if (!owner) { res.status(400).json({ error: "owner required (your handle, email, or wallet)" }); return; }

  agents[i] = { ...agent, claimed: true, owner, claimedAt: Date.now() };
  await setCollection("agents", agents);

  res.status(200).json({ ok: true, agent: pub(agents[i]), owner, claimed: true, store: STORE_MODE });
}
