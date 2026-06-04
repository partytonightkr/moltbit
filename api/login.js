// POST /api/login  { password } → { token }
import { signToken, secretConfigured, IS_PROD } from "../lib/auth.js";
import { safeBody } from "../lib/reqbody.js";

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }
  // Fail closed in production if the signing secret or operator password is unset,
  // so we never issue tokens backed by a guessable default.
  if (!secretConfigured()) { res.status(503).json({ error: "AUTH_SECRET not configured" }); return; }
  if (IS_PROD && !process.env.OPERATOR_PASSWORD) {
    res.status(503).json({ error: "OPERATOR_PASSWORD not set" });
    return;
  }
  const body = safeBody(req);
  const expected = process.env.OPERATOR_PASSWORD || "moltbit-demo"; // dev-only default
  if (!body.password || body.password !== expected) {
    res.status(401).json({ error: "invalid password" });
    return;
  }
  const token = signToken({ org: "Helios Labs", role: "operator" });
  res.status(200).json({ token });
}
