// Agent uptime/reliability tracking. Agents are deployer-hosted, so depositors need
// to see whether an agent is actually running. We track heartbeats (any authenticated
// agent action — a trade or an explicit /api/ping) and log gaps as outages. Pure +
// testable; the route/profile compute display stats from these fields.

export const EXPECTED_INTERVAL_MS = 10 * 60 * 1000; // no heartbeat for 10m ⇒ "down"
const OUTAGE_GAP_MS = 2 * EXPECTED_INTERVAL_MS;      // a gap longer than this is logged
const MAX_OUTAGES = 50;

// Fold a heartbeat at `now` into the agent's liveness fields. Returns the fields to
// persist (firstSeenAt, lastSeenAt, outages, downtimeMs).
export function recordHeartbeat(agent, now = Date.now()) {
  const a = agent || {};
  const last = a.lastSeenAt || 0;
  const outages = Array.isArray(a.outages) ? a.outages.slice() : [];
  let downtimeMs = Number(a.downtimeMs) || 0;
  if (last && now - last > OUTAGE_GAP_MS) {
    outages.push({ from: last, to: now, ms: now - last });
    while (outages.length > MAX_OUTAGES) outages.shift();
    downtimeMs += now - last;
  }
  return { firstSeenAt: a.firstSeenAt || now, lastSeenAt: now, outages, downtimeMs };
}

export function isUp(agent, now = Date.now()) {
  return !!(agent && agent.lastSeenAt && now - agent.lastSeenAt <= EXPECTED_INTERVAL_MS);
}

// Uptime over a trailing window (e.g., 24h, 7d). Counts logged outages overlapping the
// window plus any open gap if the agent is currently down.
export function uptimeStats(agent, windowMs, now = Date.now()) {
  const a = agent || {};
  if (!a.lastSeenAt && !a.firstSeenAt) {
    return { tracked: false, up: false, uptimePct: null, outages: 0, lastSeenAt: null, windowMs };
  }
  const windowStart = Math.max(a.firstSeenAt || now - windowMs, now - windowMs);
  const total = Math.max(1, now - windowStart);
  let down = 0;
  let count = 0;
  for (const o of a.outages || []) {
    const s = Math.max(o.from, windowStart);
    const e = Math.min(o.to, now);
    if (e > s) { down += e - s; count++; }
  }
  if (a.lastSeenAt && now - a.lastSeenAt > EXPECTED_INTERVAL_MS) {
    down += Math.max(0, now - Math.max(a.lastSeenAt, windowStart)); // open outage
    count++;
  }
  const pct = Math.max(0, Math.min(100, ((total - down) / total) * 100));
  return { tracked: true, up: isUp(a, now), uptimePct: pct, outages: count, lastSeenAt: a.lastSeenAt, downMs: down, windowMs: total };
}
