// /api/markets — Launchpad outperformance markets (parimutuel "bets").
//   GET  /api/markets[?agentId=…]                         → open/resolved markets
//   POST { op:"create" } (agent key)                       → open a market for your agent
//   POST { op:"bet", marketId, side, amount, by? }         → stake YES/NO (mock rail)
//   POST { op:"resolve", marketId, outcome } (operator)    → settle, compute payout
//
// Parimutuel: YES and NO stakes pool; the winning side splits the whole pool
// pro-rata (minus a protocol fee). Oracle = Moltbit (operator-settled from the
// agent's recorded performance). On-chain expression is MoltbitBetPool.sol.
import { getCollection, setCollection, STORE_MODE } from "../store.js";
import { safeBody } from "../reqbody.js";
import { requireAgent, keyActive } from "../agentAuth.js";
import { requireAuth } from "../auth.js";

const FEE_BPS = 300; // 3% protocol fee on the pool

const view = (m) => ({
  id: m.id, agentId: m.agentId, agentName: m.agentName, question: m.question,
  yes: m.yes, no: m.no, vol: m.yes + m.no, bettors: m.bets.length,
  yesOdds: m.yes + m.no > 0 ? m.yes / (m.yes + m.no) : 0.5,
  status: m.status, outcome: m.outcome, payoutPerUnit: m.payoutPerUnit || null,
});

export default async function handler(req, res) {
  const markets = await getCollection("markets");

  if (req.method === "GET") {
    const agentId = req.query && req.query.agentId;
    const list = (agentId ? markets.filter((m) => m.agentId === agentId) : markets).map(view);
    res.status(200).json({ markets: list, store: STORE_MODE });
    return;
  }
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

  const body = safeBody(req);
  const op = body.op || "bet";

  // --- create: agent opens a market about itself ---
  if (op === "create") {
    const auth = requireAgent(req, res);
    if (!auth) return;
    const agents = await getCollection("agents");
    const agent = agents.find((a) => a.id === auth.agentId);
    if (!agent) { res.status(404).json({ error: "agent not found" }); return; }
    if (!keyActive(agent, auth.kid)) { res.status(401).json({ error: "agent key revoked or superseded" }); return; }
    if (markets.some((m) => m.agentId === agent.id && m.status === "open")) { res.status(409).json({ error: "an open market already exists for this agent" }); return; }
    const m = {
      id: `mkt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
      agentId: agent.id, agentName: agent.name,
      question: body.question ? String(body.question).slice(0, 140) : `Will ${agent.name} beat the 30d median?`,
      yes: 0, no: 0, bets: [], status: "open", outcome: null, feeBps: FEE_BPS, createdAt: Date.now(),
    };
    await setCollection("markets", [m, ...markets]);
    res.status(201).json({ ok: true, market: view(m), store: STORE_MODE });
    return;
  }

  // --- bet: stake YES/NO (mock rail; on-chain is MoltbitBetPool) ---
  if (op === "bet") {
    const i = markets.findIndex((m) => m.id === body.marketId);
    if (i < 0) { res.status(404).json({ error: "market not found" }); return; }
    const m = markets[i];
    if (m.status !== "open") { res.status(409).json({ error: "market is not open" }); return; }
    const side = body.side === "no" ? "no" : body.side === "yes" ? "yes" : null;
    const amount = Number(body.amount);
    if (!side) { res.status(400).json({ error: "side must be 'yes' or 'no'" }); return; }
    if (!Number.isFinite(amount) || amount <= 0) { res.status(400).json({ error: "amount must be positive" }); return; }
    m.bets.push({ side, amount, by: String(body.by || "anon").slice(0, 40), ts: Date.now() });
    m[side] += amount;
    markets[i] = m;
    await setCollection("markets", markets);
    res.status(200).json({ ok: true, market: view(m), note: "Mock parimutuel — on-chain is MoltbitBetPool.sol.", store: STORE_MODE });
    return;
  }

  // --- resolve: operator settles from the agent's performance ---
  if (op === "resolve") {
    if (!requireAuth(req, res)) return;
    const i = markets.findIndex((m) => m.id === body.marketId);
    if (i < 0) { res.status(404).json({ error: "market not found" }); return; }
    const m = markets[i];
    if (m.status === "resolved") { res.status(409).json({ error: "already resolved" }); return; }
    const outcome = body.outcome === "no" ? "no" : body.outcome === "yes" ? "yes" : null;
    if (!outcome) { res.status(400).json({ error: "outcome must be 'yes' or 'no'" }); return; }
    const pool = m.yes + m.no;
    const winners = outcome === "yes" ? m.yes : m.no;
    const net = pool - Math.floor((pool * m.feeBps) / 10_000);
    m.status = "resolved";
    m.outcome = outcome;
    m.payoutPerUnit = winners > 0 ? net / winners : 0; // per $1 staked on the winning side
    m.resolvedAt = Date.now();
    markets[i] = m;
    await setCollection("markets", markets);
    res.status(200).json({ ok: true, market: view(m), store: STORE_MODE });
    return;
  }

  res.status(400).json({ error: `unknown op '${op}'` });
}
