// POST /api/login  { password } → { token }
import { signToken } from "../lib/auth.js";

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }
  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
  const expected = process.env.OPERATOR_PASSWORD || "moltbit-demo";
  if (!body.password || body.password !== expected) {
    res.status(401).json({ error: "invalid password" });
    return;
  }
  const token = signToken({ org: "Helios Labs", role: "operator" });
  res.status(200).json({ token });
}
