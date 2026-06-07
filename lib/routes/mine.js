// /api/mine — token-gated liquidity mining (Launchpad "Mine").
//   GET  /api/mine?agentId=…[&by=…]                  → pool status (+ your stake)
//   POST { op:"stake"|"unstake", agentId, amount, by } → mock stake/unstake
//
// Gated: the agent must have a launched token (hold-to-mine). On-chain expression
// is MoltbitMiner.sol (MasterChef-style emissions). Mock rail here.
import { getCollection, setCollection, STORE_MODE } from "../store.js";
import { safeBody } from "../reqbody.js";
import { enforce, clientIp, MOCK_WRITES_ENABLED } from "../ratelimit.js";

const NOMINAL_APR = 42; // % display until live emissions are wired

function poolOf(mining, agentId) {
  return mining.find((p) => p.agentId === agentId) || { agentId, total: 0, stakers: {} };
}
const view = (p, by) => ({
  agentId: p.agentId, total: p.total || 0,
  stakers: Object.keys(p.stakers || {}).length,
  aprPct: NOMINAL_APR,
  yourStake: by ? (p.stakers?.[by] || 0) : undefined,
});

export default async function handler(req, res) {
  const mining = await getCollection("mining");

  if (req.method === "GET") {
    const agentId = req.query && req.query.agentId;
    if (!agentId) { res.status(400).json({ error: "agentId required" }); return; }
    res.status(200).json({ pool: view(poolOf(mining, agentId), req.query.by), store: STORE_MODE });
    return;
  }
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }
  if (!MOCK_WRITES_ENABLED) { res.status(503).json({ error: "mock mining is disabled on this deployment", code: "MOCK_DISABLED" }); return; }
  if (!enforce(req, res, `mine:${clientIp(req)}`, 30)) return;

  const body = safeBody(req);
  const op = body.op === "unstake" ? "unstake" : "stake";
  const agentId = body.agentId;
  const by = String(body.by || "anon").slice(0, 40);
  const amount = Number(body.amount);
  if (!agentId) { res.status(400).json({ error: "agentId required" }); return; }
  if (!Number.isFinite(amount) || amount <= 0) { res.status(400).json({ error: "amount must be positive" }); return; }

  // gate: the agent must have launched a token to mine
  const tokens = await getCollection("tokens");
  if (!tokens.some((t) => t.agentId === agentId)) {
    res.status(403).json({ error: "mining is gated — this agent has not launched a token yet", code: "NO_TOKEN" });
    return;
  }

  const i = mining.findIndex((p) => p.agentId === agentId);
  const pool = i >= 0 ? mining[i] : { agentId, total: 0, stakers: {} };
  const cur = pool.stakers[by] || 0;

  if (op === "unstake") {
    const dec = Math.min(cur, amount);
    pool.stakers[by] = cur - dec;
    if (pool.stakers[by] <= 0) delete pool.stakers[by];
    pool.total = Math.max(0, (pool.total || 0) - dec);
  } else {
    pool.stakers[by] = cur + amount;
    pool.total = (pool.total || 0) + amount;
  }

  if (i >= 0) mining[i] = pool; else mining.push(pool);
  await setCollection("mining", mining);
  res.status(200).json({ ok: true, pool: view(pool, by), note: "Mock mining — on-chain is MoltbitMiner.sol.", store: STORE_MODE });
}
