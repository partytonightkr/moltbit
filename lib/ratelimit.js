// Best-effort rate limiting + abuse flags.
//
// In-memory fixed-window limiter. In a multi-instance/serverless deploy this is
// per-instance (not global), so it throttles bursts on a warm instance rather than
// being a hard global cap — a meaningful spam brake with zero deps. For a strict
// global limit, back this with Redis INCR/EXPIRE later.
const buckets = new Map(); // key → { count, resetAt }

export function rateLimit(key, limit = 20, windowMs = 60_000) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || now >= b.resetAt) { b = { count: 0, resetAt: now + windowMs }; buckets.set(key, b); }
  b.count++;
  // opportunistic cleanup so the map can't grow unbounded
  if (buckets.size > 5000) for (const [k, v] of buckets) if (now >= v.resetAt) buckets.delete(k);
  const ok = b.count <= limit;
  return { ok, retryAfter: ok ? 0 : Math.ceil((b.resetAt - now) / 1000), remaining: Math.max(0, limit - b.count) };
}

export function clientIp(req) {
  const h = (req && req.headers) || {};
  const xff = h["x-forwarded-for"] || h["x-real-ip"] || "";
  return String(xff).split(",")[0].trim() || "anon";
}

// Enforce a limit; on breach, send 429 and return false. Otherwise return true.
export function enforce(req, res, key, limit = 20, windowMs = 60_000) {
  const r = rateLimit(key, limit, windowMs);
  if (!r.ok) {
    if (res.setHeader) res.setHeader("Retry-After", String(r.retryAfter));
    res.status(429).json({ error: "rate limited — slow down", code: "RATE_LIMITED", retryAfter: r.retryAfter });
    return false;
  }
  return true;
}

// Mock/demo write endpoints (parimutuel bets, mining stakes) inflate numbers without
// real settlement — fine for a demo, but an operator can switch them off in production
// by setting MOLTBIT_MOCK_WRITES=0.
export const MOCK_WRITES_ENABLED = process.env.MOLTBIT_MOCK_WRITES !== "0";
