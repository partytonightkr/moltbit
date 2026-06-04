// Agent key auth — the scoped signing key shown in the connect-agent wizard
// (mbk_live_… / mbk_test_…). Trade-only: it authorizes order intents at the
// gateway, never fund movement. HMAC-signed, no DB needed for the signature.
//
// Format:  mbk_<env>_<agentId>.<kid>.<sigHex>
//   kid = key version (integer, bumped on rotation/revocation)
//   sig = HMAC-SHA256( `${env}:${agentId}:${kid}`, AGENT_SECRET ) [first 24 bytes hex]
// Legacy format (no kid) is still accepted as kid=0 for backwards compatibility.
//
// Revocation: the signature is stateless, so to revoke a leaked key WITHOUT
// rotating the global secret, bump the agent's `keyVersion` (rotateAgentKey) or
// set `keyRevoked`. The gateway calls keyActive(agent, kid) to enforce it.
//
// Set AGENT_SECRET in the environment (any long random string). In production a
// weak/default secret is refused (fail-closed) rather than silently insecure.

import crypto from "node:crypto";

const RAW_SECRET = process.env.AGENT_SECRET || process.env.AUTH_SECRET || "";
const IS_PROD = process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production";
const SECRET = RAW_SECRET || "dev-agent-secret-change-me";

// In production a real, non-trivial secret must be set; otherwise we fail closed.
export function secretConfigured() {
  if (!IS_PROD) return true;
  return RAW_SECRET.length >= 16;
}

function sign(env, agentId, kid) {
  return crypto.createHmac("sha256", SECRET).update(`${env}:${agentId}:${kid}`).digest("hex").slice(0, 48);
}

// Legacy signature (no kid in the payload) — kept so pre-existing keys keep working.
function signLegacy(env, agentId) {
  return crypto.createHmac("sha256", SECRET).update(`${env}:${agentId}`).digest("hex").slice(0, 48);
}

function normalizeId(agentId) {
  return String(agentId).toLowerCase().replace(/[^a-z0-9-]+/g, "-").slice(0, 32);
}

function ctEq(a, b) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// Mint a scoped key for an agent at a given key version. env = "live" | "test".
export function mintAgentKey(agentId, env = "test", kid = 0) {
  const id = normalizeId(agentId);
  const v = Math.max(0, Math.floor(Number(kid) || 0));
  return `mbk_${env}_${id}.${v}.${sign(env, id, v)}`;
}

// Parse + verify the signature. Returns { ok, agentId, env, kid } or { ok:false }.
// NOTE: this checks the signature only — call keyActive() for revocation/rotation.
export function verifyAgentKey(key) {
  if (typeof key !== "string") return { ok: false };

  // current format: mbk_<env>_<id>.<kid>.<sig>
  let m = key.match(/^mbk_(live|test)_([a-z0-9-]{1,32})\.(\d{1,9})\.([a-f0-9]{48})$/);
  if (m) {
    const [, env, agentId, kid, sig] = m;
    if (ctEq(sig, sign(env, agentId, kid))) return { ok: true, agentId, env, kid: Number(kid) };
    return { ok: false };
  }

  // legacy format: mbk_<env>_<id>.<sig>  (treated as kid 0)
  m = key.match(/^mbk_(live|test)_([a-z0-9-]{1,32})\.([a-f0-9]{48})$/);
  if (m) {
    const [, env, agentId, sig] = m;
    if (ctEq(sig, signLegacy(env, agentId))) return { ok: true, agentId, env, kid: 0 };
  }
  return { ok: false };
}

// Stateful gate: is this key version still the active one for the agent?
// (Revoked keys, or keys from before a rotation, are rejected.)
export function keyActive(agent, kid) {
  if (!agent) return true; // unknown agent → leave to caller (signature already valid)
  if (agent.keyRevoked) return false;
  return Number(agent.keyVersion || 0) === Number(kid || 0);
}

// Express-style guard: pulls the key from Authorization: Bearer or x-agent-key,
// verifies the signature, and (in prod) refuses to run without a real secret.
// Returns { agentId, env, kid } or writes the error and returns null.
// Revocation/rotation is enforced separately by the caller via keyActive().
export function requireAgent(req, res) {
  if (!secretConfigured()) {
    res.status(503).json({ error: "AGENT_SECRET not configured — refusing to authenticate" });
    return null;
  }
  const hdr = req.headers["authorization"] || "";
  const bearer = hdr.startsWith("Bearer ") ? hdr.slice(7) : null;
  const key = bearer || req.headers["x-agent-key"];
  const v = verifyAgentKey(key);
  if (!v.ok) {
    res.status(401).json({ error: "invalid or missing agent key" });
    return null;
  }
  return v; // { agentId, env, kid }
}
