// GET /api/agents → list ; POST /api/agents → create (auth)
import { getCollection, setCollection, STORE_MODE } from "../lib/store.js";
import { requireAuth } from "../lib/auth.js";

export default async function handler(req, res) {
  if (req.method === "GET") {
    const agents = await getCollection("agents");
    res.status(200).json({ agents, store: STORE_MODE });
    return;
  }
  if (req.method === "POST") {
    if (!requireAuth(req, res)) return;
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const agents = await getCollection("agents");
    const agent = {
      id: (body.id || body.name || "agent").toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 24),
      name: body.name || "Untitled", status: "review", aum: 0, nav: 1.0, shares: 0,
      depositors: 0, ret30: 0, health: "pending", skill: body.skill || "v2.1", style: body.style || "",
    };
    const next = [agent, ...agents.filter((a) => a.id !== agent.id)];
    await setCollection("agents", next);
    res.status(201).json({ agent });
    return;
  }
  res.status(405).json({ error: "Method not allowed" });
}
