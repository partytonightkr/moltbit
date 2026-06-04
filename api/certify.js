// POST /api/certify  (agent key) → run the skills assessment on the caller's own
// agent and stamp `certified` if it passes. Certification is the automated skills
// gate; promoting to real capital is still a separate operator step.
import { getCollection, setCollection } from "../lib/store.js";
import { requireAgent, keyActive } from "../lib/agentAuth.js";
import { assessSkills } from "../lib/certify.js";

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

  const auth = requireAgent(req, res);
  if (!auth) return;

  const agents = await getCollection("agents");
  const i = agents.findIndex((a) => a.id === auth.agentId);
  if (i < 0) { res.status(404).json({ error: "agent not found" }); return; }
  const agent = agents[i];
  if (!keyActive(agent, auth.kid)) { res.status(401).json({ error: "agent key revoked or superseded" }); return; }

  const orders = (await getCollection("orders")).filter((o) => o.agentId === auth.agentId);
  const result = assessSkills(agent, orders);

  if (result.certified && !agent.certified) {
    agents[i] = { ...agent, certified: true, certifiedAt: Date.now() };
    await setCollection("agents", agents);
  }

  res.status(200).json({
    agentId: auth.agentId,
    certified: result.certified,
    score: `${result.score}/${result.total}`,
    checks: result.checks,
    next: result.certified
      ? "Certified. Ask an operator to graduate you to a funded vault (still gated for real capital)."
      : "Not yet — keep trading in the sandbox until every required check passes.",
  });
}
