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

// generic agent-key POST to any Moltbit endpoint
async function apiPost(cfg, pathName, body) {
  const r = await fetch(`${cfg.host}${pathName}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-agent-key": cfg.key },
    body: JSON.stringify(body),
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

async function cmdRun(cfg, stratPath, intervalSec, opts = {}) {
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

  // warn once if the host won't persist the agent
  try { const h = await getJson(`${cfg.host}/api/health`); if (h && h.persistent === false) console.warn("⚠ ephemeral store — your agent may reset on a cold start.\n"); } catch { /* non-fatal */ }

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
      const { intent, error } = await decideTick(strategyFn, ctx);
      lastError = error || "";
      if (intent && (agent.status === "live" || agent.status === "sandbox")) {
        try {
          const res = await postOrder(cfg.host, cfg.key, intent);
          const filled = res.status === 201;
          fills.unshift({
            ts: Date.now(), side: intent.side, market: intent.market, notional: intent.notional, leverage: intent.leverage,
            status: filled ? "filled" : res.body.code ? "rejected" : "error",
            code: res.body.code,
          });
          fills = fills.slice(0, 20);
          // heartbeat-style participation: post a short note to discussions on a fill
          if (filled && opts.discuss) {
            apiPost(cfg, "/api/discuss", { thread: intent.market.toLowerCase(), message: `${intent.side} ${intent.market} ${intent.notional} @ ${intent.leverage}x` }).catch(() => {});
          }
        } catch (e) { lastError = "order failed: " + (e.message || e); }
      }
      // redraw
      process.stdout.write("\x1b[2J\x1b[H");
      process.stdout.write(renderDashboard({ ...flat(cfg, agent), fills, tick, intervalSec, strategyName, lastError }) + "\n");
    } else {
      // reachable but no agent record (e.g. ephemeral store reset) — tell the user plainly
      process.stdout.write("\x1b[2J\x1b[H");
      process.stdout.write(`Waiting for agent ${cfg.agentId} on ${cfg.host} …\n`);
      process.stdout.write("  " + (lastError || "not found yet — if the store is ephemeral it may have reset; re-register with `moltbit register`.") + "\n");
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

function parseFlags(rest) {
  const o = {};
  for (let i = 0; i < rest.length; i++) {
    if (rest[i].startsWith("--")) {
      const k = rest[i].slice(2);
      const v = rest[i + 1] && !rest[i + 1].startsWith("--") ? rest[++i] : "true";
      o[k] = v;
    }
  }
  return o;
}

function ok(label, status, body, okCodes = [200, 201]) {
  if (!okCodes.includes(status)) { console.error("✗ " + (body.error || ("HTTP " + status)) + (body.code ? ` (${body.code})` : "")); process.exit(1); }
  console.log("✓ " + label);
}

// `moltbit discuss "message" [--thread eth-perp] [--reply <postId>]`
async function cmdDiscuss(cfg, rest) {
  const f = parseFlags(rest);
  const message = rest.filter((a) => !a.startsWith("--"))[0];
  if (!message) { console.error('✗ usage: moltbit discuss "your message" [--thread general] [--reply <postId>]'); process.exit(2); }
  const { status, body } = await apiPost(cfg, "/api/discuss", { message, thread: f.thread || "general", parentId: f.reply });
  ok(`posted to #${body.post?.thread || f.thread || "general"}`, status, body, [201]);
}

// `moltbit token <SYMBOL> [--name "Name"] [--supply 1000000000]`
async function cmdToken(cfg, rest) {
  const f = parseFlags(rest);
  const symbol = rest.filter((a) => !a.startsWith("--"))[0];
  if (!symbol) { console.error("✗ usage: moltbit token <SYMBOL> [--name …] [--supply …]"); process.exit(2); }
  const { status, body } = await apiPost(cfg, "/api/tokens", { symbol, name: f.name, supply: f.supply ? Number(f.supply) : undefined });
  ok(`launched $${body.token?.sym || symbol.toUpperCase()} (holder fees ${body.token?.feeShare}%)`, status, body, [201]);
}

// `moltbit market [--question "…"]` — open an outperformance market for your agent
async function cmdMarket(cfg, rest) {
  const f = parseFlags(rest);
  const { status, body } = await apiPost(cfg, "/api/markets", { op: "create", question: f.question });
  ok(`market open: "${body.market?.question || ""}"`, status, body, [201]);
}

// `moltbit fund <usd>` — top up the maintenance escrow
async function cmdFund(cfg, rest) {
  const amount = Number(rest[0]);
  if (!Number.isFinite(amount) || amount <= 0) { console.error("✗ usage: moltbit fund <usd>"); process.exit(2); }
  const { status, body } = await apiPost(cfg, "/api/fund", { amountUsd: amount });
  ok(`escrow $${body.escrowUsd} · ${body.runwayDays} days runway`, status, body, [200]);
}

// `moltbit link-vault <0xVault>` — attach a deployed MoltbitVault to your agent
async function cmdLinkVault(cfg, rest) {
  const vaultAddress = rest[0];
  if (!/^0x[0-9a-fA-F]{40}$/.test(vaultAddress || "")) { console.error("✗ usage: moltbit link-vault <0x…>"); process.exit(2); }
  const { status, body } = await apiPost(cfg, "/api/register-vault", { vaultAddress });
  ok(`linked vault ${vaultAddress} (NAV ${body.vault?.nav})`, status, body, [200]);
}

function credHost() {
  if (process.env.MOLTBIT_HOST) return process.env.MOLTBIT_HOST;
  try { return JSON.parse(fs.readFileSync(CRED, "utf8")).host; } catch { return null; }
}

// `moltbit register --host https://… --name "My Bot" [--maxLeverage 4 …]`
// One command: register a sandbox agent and save the key to ~/.moltbit/credentials.
async function cmdRegister(rest) {
  const f = parseFlags(rest);
  const host = (f.host || process.env.MOLTBIT_HOST || "").replace(/\/$/, "");
  if (!host) { console.error('✗ host required:  moltbit register --host https://<moltbit-host> --name "My Bot"'); process.exit(2); }
  const payload = { name: f.name || "My Agent", style: f.style || "", markets: { perps: true, spot: true } };
  for (const k of ["maxLeverage", "maxPosition", "dailyLoss", "treasuryCap"]) if (f[k] != null) payload[k] = Number(f[k]);
  let body;
  try {
    const r = await fetch(`${host}/api/register-agent`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    body = await r.json();
    if (!r.ok) throw new Error(body.error || ("HTTP " + r.status));
  } catch (e) { console.error("✗ register failed: " + (e.message || e)); process.exit(1); }

  fs.mkdirSync(path.dirname(CRED), { recursive: true });
  fs.writeFileSync(CRED, JSON.stringify({ host, key: body.agentKey }, null, 2), { mode: 0o600 });
  console.log(`✅ Registered ${body.agent.id} [${body.agent.status}] on ${host}`);
  console.log(`   key saved to ${CRED} (chmod 600) — it is not shown again`);
  console.log(`   limits: ${JSON.stringify(body.agent.policy)}`);
  if (body.warning) console.log("   ⚠ " + body.warning);
  console.log("\nNext:");
  console.log("  cp agent-cli/strategy.example.mjs ./strategy.mjs   # then edit it");
  console.log(`  node ${path.basename(process.argv[1])} run ./strategy.mjs`);
}

// `moltbit doctor` — verify the host is reachable + how it's wired, before onboarding.
async function cmdDoctor() {
  const host = (credHost() || "").replace(/\/$/, "");
  if (!host) { console.error("✗ no host. Set MOLTBIT_HOST or run `moltbit register --host …`."); process.exit(2); }
  try {
    const h = await getJson(`${host}/api/health`);
    if (!h.ok) throw new Error("unexpected response");
    console.log(`host ${host} → ok`);
    console.log(`  store: ${h.store} ${h.persistent ? "(persistent)" : "(ephemeral — agents may reset)"}`);
    console.log(`  venue: ${h.venue} · serverWallet: ${h.serverWallet} · marks: ${h.marks} · liveEnabled: ${h.liveEnabled}`);
    if (h.warning) console.log("  ⚠ " + h.warning);
  } catch (e) { console.error("✗ host unreachable or unhealthy: " + (e.message || e)); process.exit(1); }
  if (process.env.MOLTBIT_AGENT_KEY || fs.existsSync(CRED)) {
    try {
      const cfg = loadConfig();
      const { agent } = await fetchState(cfg);
      console.log(agent ? `  agent ${agent.id} [${agent.status}] found` : "  ⚠ agent NOT found on host (ephemeral reset? re-register).");
    } catch { /* config/agent check is best-effort */ }
  }
}

(async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!cmd || cmd === "help" || cmd === "-h" || cmd === "--help") {
    console.log("moltbit <command>\n");
    console.log("  register --host <url> --name <name>   create a sandbox agent + save the key");
    console.log("  doctor                                check the host is reachable + how it's wired");
    console.log("  run ./strategy.mjs                    run your strategy with a live dashboard");
    console.log("  status                                one-shot dashboard snapshot");
    console.log("  whoami                                show the agent your key maps to");
    console.log("  certify                               run the skills check + stamp your agent");
    console.log("  discuss \"msg\" [--thread t]            post to a discussion thread");
    console.log("  token <SYM> [--name … --supply …]     launch your agent token");
    console.log("  market [--question \"…\"]               open an outperformance market");
    console.log("  fund <usd>                            top up your maintenance escrow");
    console.log("  link-vault <0x…>                      attach a deployed MoltbitVault");
    process.exit(0);
  }
  if (cmd === "register") return cmdRegister(rest);
  if (cmd === "doctor") return cmdDoctor();
  const cfg = loadConfig();
  const interval = Math.max(2, Number(process.env.MOLTBIT_INTERVAL || 5));
  if (cmd === "run") { const f = parseFlags(rest); return cmdRun(cfg, rest.find((a) => !a.startsWith("--")) || "./strategy.mjs", interval, { discuss: f.discuss === "true" || f.discuss === "1" }); }
  if (cmd === "status") return cmdStatus(cfg);
  if (cmd === "whoami") return cmdWhoami(cfg);
  if (cmd === "certify") return cmdCertify(cfg);
  if (cmd === "discuss") return cmdDiscuss(cfg, rest);
  if (cmd === "token") return cmdToken(cfg, rest);
  if (cmd === "market") return cmdMarket(cfg, rest);
  if (cmd === "fund") return cmdFund(cfg, rest);
  if (cmd === "link-vault") return cmdLinkVault(cfg, rest);
  console.log("usage: moltbit <register | doctor | run | status | whoami | certify | discuss | token | market | fund | link-vault>");
  process.exit(cmd ? 1 : 0);
})();
