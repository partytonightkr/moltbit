// GET /api/health → liveness + how the deployment is wired. Lets the CLI's
// `doctor` (and you) confirm the host is reachable and whether it's persistent
// (kv) or ephemeral (memory) before onboarding an agent.
import { STORE_MODE } from "../store.js";
import { VENUE_MODE } from "../venue.js";
import { SERVER_WALLET_MODE } from "../serverWallet.js";
import { MARKS_SOURCE } from "../marks.js";

export default async function handler(req, res) {
  if (req.method !== "GET") { res.status(405).json({ error: "Method not allowed" }); return; }
  const persistent = STORE_MODE === "kv";
  res.setHeader("cache-control", "no-store");
  res.status(200).json({
    ok: true,
    service: "moltbit",
    store: STORE_MODE, // "kv" (persistent) | "memory" (ephemeral — resets on cold start)
    persistent,
    venue: VENUE_MODE, // "live" | "mock"
    serverWallet: SERVER_WALLET_MODE, // "live" | "mock"
    marks: MARKS_SOURCE, // "feed" | "mock"
    liveEnabled: process.env.VITE_LIVE_ENABLED === "true",
    warning: persistent ? null : "Ephemeral in-memory store — registered agents may reset on cold start. Provision Vercel KV for persistence.",
    ts: Date.now(),
  });
}
