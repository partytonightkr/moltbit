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
import { enforce, clientIp, MOCK_WRITES_ENABLED } from "../ratelimit.js";

const FEE_BPS = 300; // 3% protocol fee on the pool
const GRAD_THRESHOLD = 0.8; // YES odds at which the pool can graduate

const view = (m) => {
  const vol = m.yes + m.no;
  const yesOdds = vol > 0 ? m.yes / vol : 0.5;
  return {
    id: m.id, agentId: m.agentId, agentName: m.agentName, question: m.question,
    yes: m.yes, no: m.no, vol, bettors: m.bets.length, yesOdds,
    status: m.status, outcome: m.outcome, payoutPerUnit: m.payoutPerUnit || null,
    graduable: m.status === "open" && vol > 0 && yesOdds >= GRAD_THRESHOLD,
  };
};

export default async function handler(req, res) {
  const markets = await getCollection("markets");

  if (req.method === "GET") {
    const agentId = req.query && req.query.agentId;
    const list = (agentId ? markets.filter((m) => m.agentId === agentId) : markets).map(view);
    const graduated = await getCollection("graduated");
    res.status(200).json({ markets: list, graduated, store: STORE_MODE });
    return;
  }
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

  const body = safeBody(req);
  const op = body.op || "bet";

  // --- create: agent opens a market about itself ---
  if (op === "create") {
    const auth = requireAgent(req, res);
    if (!auth) return;
    if (!enforce(req, res, `mktcreate:${auth.agentId}`, 5)) return;
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
    if (!MOCK_WRITES_ENABLED) { res.status(503).json({ error: "mock betting is disabled on this deployment", code: "MOCK_DISABLED" }); return; }
    if (!enforce(req, res, `bet:${clientIp(req)}`, 30)) return;
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

  // --- graduate: permissionless once the pool crosses the threshold ---
  if (op === "graduate") {
    if (!enforce(req, res, `grad:${clientIp(req)}`, 5)) return;
    const i = markets.findIndex((m) => m.id === body.marketId);
    if (i < 0) { res.status(404).json({ error: "market not found" }); return; }
    const m = markets[i];
    const vol = m.yes + m.no;
    const yesOdds = vol > 0 ? m.yes / vol : 0;
    if (m.status !== "open") { res.status(409).json({ error: "market is not open" }); return; }
    if (!(vol > 0 && yesOdds >= GRAD_THRESHOLD)) {
      res.status(403).json({ error: `not graduable — needs YES ≥ ${Math.round(GRAD_THRESHOLD * 100)}% with volume`, code: "NOT_GRADUABLE" });
      return;
    }

    // resolve the market YES and freeze the strategy into a static vault record
    const net = vol - Math.floor((vol * m.feeBps) / 10_000);
    m.status = "resolved";
    m.outcome = "yes";
    m.payoutPerUnit = m.yes > 0 ? net / m.yes : 0;
    m.resolvedAt = Date.now();
    markets[i] = m;
    await setCollection("markets", markets);

    const agents = await getCollection("agents");
    const ai = agents.findIndex((a) => a.id === m.agentId);
    const agent = ai >= 0 ? agents[ai] : null;
    if (agent) {
      agents[ai] = { ...agent, graduated: true, frozen: true, graduatedAt: Date.now() };
      await setCollection("agents", agents);
    }

    const graduated = await getCollection("graduated");
    const entry = {
      id: `grad-${m.agentId}`,
      agentId: m.agentId,
      name: `${m.agentName} Vault`,
      ticker: "g" + (agent?.tokenSym || "VAULT"),
      from: m.agentName,
      graduatedOn: new Date().toISOString().slice(0, 10),
      rule: "Market voted YES — strategy parameters frozen into a static, non-discretionary vault.",
      apr: Math.round(40 + yesOdds * 30), // illustrative until live vault NAV
      tvl: +(vol / 1000).toFixed(2), // pool size in $k → $M-ish display unit
      depositors: m.bets.length,
    };
    if (!graduated.some((g) => g.id === entry.id)) {
      await setCollection("graduated", [entry, ...graduated]);
    }
    res.status(200).json({ ok: true, graduated: entry, market: view(m), store: STORE_MODE });
    return;
  }

  res.status(400).json({ error: `unknown op '${op}'` });
}
