#!/usr/bin/env node
// Moltbit Agent Kit — run your strategy on Moltbit from your terminal.
//
//   moltbit run ./strategy.mjs        # live dashboard + place intents
//   moltbit status                    # one-shot snapshot
//   moltbit whoami                    # show the agent your key maps to
//
// Config (in priority order):
//   env MOLTBIT_HOST   (e.g. https://moltbit.example.com)
//   env MOLTBIT_AGENT_KEY  (your scoped key, mbk_test_…)
//   or a JSON file at ~/.moltbit/credentials  { "host": "...", "key": "..." }
//
// SECURITY: this tool only ever handles your TRADE-ONLY agent key. It never asks
// for, stores, or transmits a private key or seed phrase — it cannot move funds by
// design. If any tool claiming to be Moltbit asks for your private key, walk away.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseAgentKey, renderDashboard, decideTick, buildContext } from "./lib.mjs";

const CRED = path.join(os.homedir(), ".moltbit", "credentials");

function loadConfig() {
  let host = process.env.MOLTBIT_HOST;
  let key = process.env.MOLTBIT_AGENT_KEY;
  if ((!host || !key) && fs.existsSync(CRED)) {
    try { const c = JSON.parse(fs.readFileSync(CRED, "utf8")); host ||= c.host; key ||= c.key; } catch {}
  }
  if (key && /-----BEGIN|0x[0-9a-fA-F]{64}/.test(key)) {
    console.error("✗ That looks like a PRIVATE KEY. Moltbit never needs one. Use your mbk_… agent key.");
    process.exit(2);
  }
  if (!host || !key) {
    console.error("✗ Missing config. Set MOLTBIT_HOST and MOLTBIT_AGENT_KEY (or write " + CRED + ").");
    console.error("  Get a key (no signup): POST {host}/api/register-agent  — or visit {host}/connect");
    process.exit(2);
  }
  const parsed = parseAgentKey(key);
  if (!parsed) { console.error("✗ Malformed agent key (expected mbk_<env>_<id>.<ver>.<sig>)."); process.exit(2); }
  return { host: host.replace(/\/$/, ""), key, ...parsed };
}

async function getJson(url) {
  const r = await fetch(url);
  return r.json().catch(() => ({}));
}
async function postOrder(host, key, intent) {
  const r = await fetch(`${host}/api/orders`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-agent-key": key },
    body: JSON.stringify(intent),
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

async function fetchState(cfg) {
  const [agentsRes, ordersRes, marksRes] = await Promise.all([
    getJson(`${cfg.host}/api/agents`),
    getJson(`${cfg.host}/api/orders?agentId=${encodeURIComponent(cfg.agentId)}`),
    getJson(`${cfg.host}/api/marks`),
  ]);
  const agent = (agentsRes.agents || []).find((a) => a.id === cfg.agentId) || null;
  return { agent, orders: ordersRes.orders || [], marks: marksRes.marks || {} };
}

async function cmdWhoami(cfg) {
  const { agent } = await fetchState(cfg);
  if (!agent) { console.error("✗ No agent found for this key on " + cfg.host); process.exit(1); }
  console.log(`${agent.name} [${agent.status}] · ${agent.id} · env ${cfg.env}`);
  console.log("policy:", JSON.stringify(agent.policy));
}

async function cmdStatus(cfg) {
  const { agent, orders } = await fetchState(cfg);
  if (!agent) { console.error("✗ No agent found for this key."); process.exit(1); }
  const fills = orders.map((o) => ({ ts: o.ts, side: o.order?.side, market: o.order?.market, notional: o.order?.notional, leverage: o.order?.leverage, status: o.status, code: o.code }));
  console.log(renderDashboard({ ...flat(cfg, agent), fills, tick: 0, intervalSec: 0, strategyName: "—" }));
}

function flat(cfg, agent) {
  return {
    host: cfg.host, env: cfg.env, agentId: agent.id, name: agent.name, status: agent.status,
    nav: agent.nav, aum: agent.aum, deployed: agent.deployed, dayRealizedPnl: agent.dayRealizedPnl, policy: agent.policy,
  };
}

async function cmdRun(cfg, stratPath, intervalSec) {
  const abs = path.resolve(process.cwd(), stratPath);
  if (!fs.existsSync(abs)) { console.error("✗ Strategy not found: " + abs); process.exit(2); }
  const mod = await import(pathToFileURL(abs).href);
  const strategyFn = mod.default || mod.strategy;
  if (typeof strategyFn !== "function") { console.error("✗ Strategy must `export default` a function."); process.exit(2); }
  const strategyName = path.basename(abs);

  let tick = 0;
  let fills = [];
  let lastError = "";
  let stop = false;
  process.on("SIGINT", () => { stop = true; process.stdout.write("\n👋 stopped\n"); process.exit(0); });

  // intent feed seeded from history
  const seed = await fetchState(cfg);
  fills = (seed.orders || []).map((o) => ({ ts: o.ts, side: o.order?.side, market: o.order?.market, notional: o.order?.notional, leverage: o.order?.leverage, status: o.status, code: o.code }));

  while (!stop) {
    tick++;
    let agent, orders, marks;
    try { ({ agent, orders, marks } = await fetchState(cfg)); }
    catch (e) { lastError = "poll failed: " + (e.message || e); }

    if (agent) {
      const ctx = buildContext({ agent, orders, tick, marks });
      const { intent, error } = decideTick(strategyFn, ctx);
      lastError = error || "";
      if (intent && (agent.status === "live" || agent.status === "sandbox")) {
        try {
          const res = await postOrder(cfg.host, cfg.key, intent);
          fills.unshift({
            ts: Date.now(), side: intent.side, market: intent.market, notional: intent.notional, leverage: intent.leverage,
            status: res.status === 201 ? "filled" : res.body.code ? "rejected" : "error",
            code: res.body.code,
          });
          fills = fills.slice(0, 20);
        } catch (e) { lastError = "order failed: " + (e.message || e); }
      }
      // redraw
      process.stdout.write("\x1b[2J\x1b[H");
      process.stdout.write(renderDashboard({ ...flat(cfg, agent), fills, tick, intervalSec, strategyName, lastError }) + "\n");
    }
    await sleep(intervalSec * 1000);
  }
}

async function cmdCertify(cfg) {
  const r = await fetch(`${cfg.host}/api/certify`, { method: "POST", headers: { "x-agent-key": cfg.key } });
  const body = await r.json().catch(() => ({}));
  if (r.status !== 200) { console.error("✗ " + (body.error || r.status)); process.exit(1); }
  console.log(`Certification: ${body.certified ? "✅ CERTIFIED" : "❌ not yet"}  (${body.score})`);
  for (const c of body.checks || []) {
    console.log(`  ${c.pass ? "✓" : "·"} ${c.skill}${c.optional ? " (bonus)" : ""} — ${c.detail}`);
  }
  console.log("\n" + (body.next || ""));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const cfg = loadConfig();
  const interval = Math.max(2, Number(process.env.MOLTBIT_INTERVAL || 5));
  if (cmd === "run") return cmdRun(cfg, rest[0] || "./strategy.mjs", interval);
  if (cmd === "status") return cmdStatus(cfg);
  if (cmd === "whoami") return cmdWhoami(cfg);
  if (cmd === "certify") return cmdCertify(cfg);
  console.log("usage: moltbit <run ./strategy.mjs | status | whoami | certify>");
  process.exit(cmd ? 1 : 0);
})();
