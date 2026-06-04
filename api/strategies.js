// GET /api/strategies → list ; POST /api/strategies → create/update (auth)
import { getCollection, setCollection } from "../lib/store.js";
import { requireAuth } from "../lib/auth.js";

export default async function handler(req, res) {
  if (req.method === "GET") {
    res.status(200).json({ strategies: await getCollection("strategies") });
    return;
  }
  if (req.method === "POST") {
    if (!requireAuth(req, res)) return;
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const strategies = await getCollection("strategies");
    const id = body.id || (body.name || "NEW").split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 5);
    const existing = strategies.find((s) => s.id === id);
    const merged = {
      id, name: body.name || (existing && existing.name) || "Untitled", agent: body.agent || (existing && existing.agent),
      status: body.status || (existing && existing.status) || "review", risk: body.risk || (existing && existing.risk) || "MED",
      capacity: body.capacity ?? (existing && existing.capacity) ?? 20, used: (existing && existing.used) ?? 0,
      ddHalt: body.ddHalt ?? (existing && existing.ddHalt) ?? 8, levCap: body.levCap ?? (existing && existing.levCap) ?? 2,
    };
    const next = [merged, ...strategies.filter((s) => s.id !== id)];
    await setCollection("strategies", next);
    res.status(200).json({ strategy: merged });
    return;
  }
  res.status(405).json({ error: "Method not allowed" });
}
