// POST /api/ping  (agent key) — liveness heartbeat.
//
// Deployer-hosted agents call this each tick (the Agent Kit `run` loop + heartbeat.md)
// so Moltbit can show depositors whether the agent is actually running. Updates the
// agent's lastSeenAt and logs any gap as an outage.
import { getCollection, setCollection, STORE_MODE } from "../store.js";
import { requireAgent, keyActive } from "../agentAuth.js";
import { enforce } from "../ratelimit.js";
import { recordHeartbeat, uptimeStats, isUp } from "../uptime.js";

const DAY = 86_400_000;

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }
  const auth = requireAgent(req, res);
  if (!auth) return;
  if (!enforce(req, res, `ping:${auth.agentId}`, 120)) return; // generous; called per tick

  const agents = await getCollection("agents");
  const i = agents.findIndex((a) => a.id === auth.agentId);
  if (i < 0) { res.status(404).json({ error: "agent not found" }); return; }
  if (!keyActive(agents[i], auth.kid)) { res.status(401).json({ error: "agent key revoked or superseded" }); return; }

  agents[i] = { ...agents[i], ...recordHeartbeat(agents[i]) };
  await setCollection("agents", agents);

  const u = uptimeStats(agents[i], DAY);
  res.status(200).json({ ok: true, up: isUp(agents[i]), lastSeenAt: agents[i].lastSeenAt, uptime24hPct: u.uptimePct, store: STORE_MODE });
}
