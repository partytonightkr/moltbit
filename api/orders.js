// Agent execution gateway.
//   POST /api/orders   (agent key)  → submit an order INTENT; enforced + executed
//   GET  /api/orders?agentId=…       → recent orders/fills for an agent
//
// Pipeline:  verify agent key → load policy + live state → checkOrder (policy)
//            → submit to venue → record fill in `orders` + `ledger`
//            → update agent dayRealizedPnl/deployed → auto-pause on daily-loss breach.
//
// The agent never moves funds. Margin movement to the venue is done by the gateway
// via the Privy SERVER wallet (lib/serverWallet.js), scoped to allocate-only.
import { getCollection, setCollection, appendItem } from "../lib/store.js";
import { safeBody } from "../lib/reqbody.js";
import { requireAgent, keyActive } from "../lib/agentAuth.js";
import { checkOrder, shouldHalt, DEFAULT_POLICY } from "../lib/policy.js";
import { hasRunway } from "../lib/economics.js";
import { recordHeartbeat } from "../lib/uptime.js";
import { submitOrder, VENUE_MODE } from "../lib/venue.js";
import { allocateToVenue, openVenuePosition, SERVER_WALLET_MODE } from "../lib/serverWallet.js";
import { alert } from "../lib/alert.js";

export default async function handler(req, res) {
  if (req.method === "GET") {
    const agentId = (req.query && req.query.agentId) || null;
    const orders = await getCollection("orders");
    res.status(200).json({
      orders: agentId ? orders.filter((o) => o.agentId === agentId) : orders,
      venue: VENUE_MODE,
      serverWallet: SERVER_WALLET_MODE,
    });
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  // 1. authenticate the scoped agent key
  const auth = requireAgent(req, res);
  if (!auth) return;
  const { agentId, env } = auth;

  const body = safeBody(req);
  const order = {
    market: body.market,
    side: body.side === "short" ? "short" : "long",
    notional: Number(body.notional || 0),
    leverage: Number(body.leverage || 1),
  };

  // 2. load agent + policy + live state
  const agents = await getCollection("agents");
  const ai = agents.findIndex((a) => a.id === agentId);
  if (ai < 0) { res.status(404).json({ error: "agent not found" }); return; }
  const agent = agents[ai];

  // 2a. revocation / rotation gate — reject superseded or revoked keys
  if (!keyActive(agent, auth.kid)) {
    res.status(401).json({ error: "agent key revoked or superseded — rotate the key" });
    return;
  }

  // 2b. funding gate — a LIVE agent must have maintenance-escrow runway left.
  //     Sandbox/test agents run free and always pass.
  if (!hasRunway(agent)) {
    await record({ agentId, env, order, status: "rejected", reason: "out of maintenance-escrow runway — top up to resume", code: "OUT_OF_RUNWAY" });
    res.status(402).json({ error: "out of runway", code: "OUT_OF_RUNWAY", reason: "live agent has no maintenance-escrow runway left — top up to resume" });
    return;
  }

  const policy = agent.policy || DEFAULT_POLICY;
  const state = {
    status: agent.status === "live" ? "live" : agent.status, // live|paused|halted|review
    aum: Number(agent.aum || 0) * 1e6, // AUM stored in $M → USD
    deployed: Number(agent.deployed || 0),
    dayRealizedPnl: Number(agent.dayRealizedPnl || 0),
  };

  // 3. enforce policy
  const verdict = checkOrder(order, policy, state);
  if (!verdict.ok) {
    await record({ agentId, env, order, status: "rejected", reason: verdict.reason, code: verdict.code });
    res.status(403).json({ error: "policy", ...verdict });
    return;
  }

  // 4. push margin to the venue via the server wallet (allocate-only), then execute.
  //    On-chain venues (agent.venueKind === "onchain") route to the adapter contract:
  //    allocate(adapter, margin) → adapter.openTrade(...). Otherwise the HTTP venue.
  const margin = order.notional / Math.max(order.leverage, 1);
  const onchain = agent.venueKind === "onchain" && !!agent.adapterAddress;
  const venueTarget = onchain ? agent.adapterAddress : (agent.venue || "mock-venue");

  let alloc;
  try {
    alloc = await allocateToVenue({
      env,
      vaultAddress: agent.vaultAddress || null,
      venue: venueTarget,
      amountUsdc: margin,
      walletId: agent.serverWalletId || null,
    });
  } catch (e) {
    await record({ agentId, env, order, status: "error", reason: String(e.message || e), code: "ALLOC_FAILED" });
    res.status(502).json({ error: "allocation failed", reason: String(e.message || e) });
    return;
  }

  let exec;
  try {
    if (onchain) {
      // open the position on the adapter (real calldata when the server wallet is live)
      const open = await openVenuePosition({
        env,
        adapterAddress: agent.adapterAddress,
        walletId: agent.serverWalletId || null,
        pairIndex: Number(body.pairIndex ?? agent.pairIndex ?? 0),
        buy: order.side === "long",
        marginUsdc: margin,
        leverage: order.leverage,
        openPrice: Number(body.openPrice || 0), // 0 = market
        slippagePct: Number(body.slippagePct ?? 1),
        orderType: Number(body.orderType ?? 0),
        executionFee: body.executionFee || 0,
      });
      // PnL/price realize on close; record the open tx as the fill reference.
      exec = {
        ok: true,
        venue: "onchain",
        fill: {
          market: order.market, side: order.side, notional: order.notional, leverage: order.leverage,
          qty: null, fillPrice: null, fee: 0, ts: Date.now(), txId: open.txHash,
        },
      };
    } else {
      exec = await submitOrder(order);
    }
  } catch (e) {
    await record({ agentId, env, order, status: "error", reason: String(e.message || e), code: "EXEC_FAILED" });
    res.status(502).json({ error: "execution failed", reason: String(e.message || e) });
    return;
  }

  // 5. record fill + update agent state
  const filled = await record({
    agentId, env, order, status: "filled", fill: exec.fill, allocTx: alloc.txHash,
  });

  // realized PnL accrues on close; for an opening fill we book the fee as a small loss
  const pnlDelta = -(exec.fill?.fee || 0);
  const dayRealizedPnl = state.dayRealizedPnl + pnlDelta;
  const deployed = state.deployed + margin;
  const halted = shouldHalt(policy, dayRealizedPnl);
  agents[ai] = {
    ...agent,
    ...recordHeartbeat(agent), // a trade is also a liveness signal
    deployed,
    dayRealizedPnl,
    status: halted ? "paused" : agent.status,
    lastFillAt: Date.now(),
  };
  await setCollection("agents", agents);

  if (halted) {
    await alert(
      "agent.daily_loss_halt",
      { agentId, env, dayRealizedPnl, dailyLoss: policy.dailyLoss, vaultAddress: agent.vaultAddress },
      "error"
    );
  }

  res.status(201).json({
    ok: true,
    order: filled,
    halted,
    note: halted ? "daily-loss limit reached — agent auto-paused; pause the vault on-chain" : undefined,
    venue: VENUE_MODE,
    serverWallet: SERVER_WALLET_MODE,
  });
}

// append to the `orders` collection
async function record(entry) {
  const row = {
    id: "ORD-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6),
    ts: Date.now(),
    ...entry,
  };
  await appendItem("orders", row); // atomic prepend + cap (race-free)
  return row;
}
