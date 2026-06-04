// Agent key auth — the scoped signing key shown in the connect-agent wizard
// (mbk_live_… / mbk_test_…). Trade-only: it authorizes order intents at the
// gateway, never fund movement. HMAC-signed, no DB needed.
//
// Format:  mbk_<env>_<agentId>.<sigHex>
//   sig = HMAC-SHA256( `${env}:${agentId}`, AGENT_SECRET ) [first 24 bytes hex]
// Set AGENT_SECRET in the environment (any long random string).

import crypto from "crypto";

const SECRET = process.env.AGENT_SECRET || process.env.AUTH_SECRET || "dev-agent-secret-change-me";

function sign(env, agentId) {
  return crypto
    .createHmac("sha256", SECRET)
    .update(`${env}:${agentId}`)
    .digest("hex")
    .slice(0, 48); // 24 bytes
}

// Mint a scoped key for an agent. env = "live" | "test".
export function mintAgentKey(agentId, env = "test") {
  const id = String(agentId).toLowerCase().replace(/[^a-z0-9-]+/g, "-").slice(0, 32);
  return `mbk_${env}_${id}.${sign(env, id)}`;
}

// Parse + verify a key. Returns { ok, agentId, env } or { ok:false }.
export function verifyAgentKey(key) {
  if (typeof key !== "string") return { ok: false };
  const m = key.match(/^mbk_(live|test)_([a-z0-9-]{1,32})\.([a-f0-9]{48})$/);
  if (!m) return { ok: false };
  const [, env, agentId, sig] = m;
  const expected = sign(env, agentId);
  // constant-time compare
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false };
  return { ok: true, agentId, env };
}

// Express-style guard: pulls the key from Authorization: Bearer or x-agent-key.
export function requireAgent(req, res) {
  const hdr = req.headers["authorization"] || "";
  const bearer = hdr.startsWith("Bearer ") ? hdr.slice(7) : null;
  const key = bearer || req.headers["x-agent-key"];
  const v = verifyAgentKey(key);
  if (!v.ok) {
    res.status(401).json({ error: "invalid or missing agent key" });
    return null;
  }
  return v; // { agentId, env }
}
