// Operator auth — HMAC-signed tokens, no DB or external dep.
// Set AUTH_SECRET (any long random string) and OPERATOR_PASSWORD in Vercel env.
import crypto from "node:crypto";

const SECRET = process.env.AUTH_SECRET || "dev-insecure-secret-change-me";
const TTL_MS = 12 * 3600 * 1000; // 12h sessions

function b64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function signToken(payload) {
  const body = b64url(JSON.stringify({ ...payload, exp: Date.now() + TTL_MS }));
  const sig = b64url(crypto.createHmac("sha256", SECRET).update(body).digest());
  return `${body}.${sig}`;
}

export function verifyToken(token) {
  if (!token || token.indexOf(".") < 0) return null;
  const [body, sig] = token.split(".");
  const expected = b64url(crypto.createHmac("sha256", SECRET).update(body).digest());
  // constant-time compare
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const payload = JSON.parse(Buffer.from(body.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString());
    if (!payload.exp || Date.now() > payload.exp) return null;
    return payload;
  } catch { return null; }
}

// Express-style guard: returns the payload, or writes 401 and returns null.
export function requireAuth(req, res) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : null;
  const payload = verifyToken(token);
  if (!payload) { res.status(401).json({ error: "unauthorized" }); return null; }
  return payload;
}
