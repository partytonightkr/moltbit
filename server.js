// Portable single-process Moltbit server.
//
// Mounts every existing /api handler (the same files Vercel runs) into ONE Node
// process and serves the built SPA — so you can host Moltbit anywhere cheap
// (Fly.io, Render, Railway, an Oracle always-free VPS, etc.) with NO 12-function
// limit and NO cron restrictions. Vercel keeps working too; this is additive.
//
//   npm run build && npm start         # serves dist/ + /api on PORT (default 3000)
//
// Persistence: set UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN (or the
// KV_REST_API_* names). Without them it runs in-memory (resets on restart).
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

// original top-level functions
import agents from "./api/agents.js";
import orders from "./api/orders.js";
import strategies from "./api/strategies.js";
import settlement from "./api/settlement.js";
import claude from "./api/claude.js";
import login from "./api/login.js";
import ledger from "./api/ledger.js";
import cronSettle from "./api/cron/settle.js";
// the multiplexer (certify, claim, discuss, fund, graduate, health, kill,
// leaderboard, markets, marks, mine, pause-all, register-agent, register-vault,
// tokens, vault) — same routing as vercel.json rewrites
import router, { ROUTES } from "./api/router.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: "1mb" }));

const direct = { agents, orders, strategies, settlement, claude, login, ledger };

// cron is a 2-segment path; for self-host, trigger it however you like (external
// scheduler, `curl`, a cron job) — no platform cron limits here.
app.all("/api/cron/settle", (req, res) => cronSettle(req, res));

app.all("/api/:name", (req, res) => {
  const name = req.params.name;
  if (direct[name]) return direct[name](req, res);
  if (ROUTES[name]) { req.query.r = name; return router(req, res); } // mirror the vercel.json rewrite
  res.status(404).json({ error: "not found: /api/" + name });
});

// static SPA + public assets (skill.md, heartbeat.md, /connect, /claim, /sandbox, …)
const dist = path.join(__dirname, "dist");
app.use(express.static(dist, { extensions: ["html"] }));
// client-side routing fallback (anything not a file and not /api)
app.get("*", (req, res) => res.sendFile(path.join(dist, "index.html")));

const port = process.env.PORT || 3000;
const persisted = !!(process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL);
app.listen(port, () => console.log(`Moltbit on :${port} · store ${persisted ? "kv (persistent)" : "memory (ephemeral)"}`));
