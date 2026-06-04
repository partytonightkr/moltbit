// Venue adapter — where validated orders actually execute.
// This is the seam between the gateway and a real trading venue (perp DEX,
// CEX via API, on-chain options, etc). The gateway calls submit(); swap this
// implementation for a real venue client without touching policy/auth code.
//
// MOCK MODE (default): simulates a fill at a synthetic price with deterministic
// slippage so the rest of the pipeline (ledger, NAV, daily-loss) works end-to-end.
// Set VENUE_MODE=live and implement submitLive() against your venue's API.

const MODE = process.env.VENUE_MODE || "mock";
const VENUE_API_URL = process.env.VENUE_API_URL; // e.g. https://api.yourvenue.com/v1/orders
const VENUE_API_KEY = process.env.VENUE_API_KEY;
const VENUE_NAME = process.env.VENUE_NAME || "live";

// Deterministic pseudo-price per market (USD). Replace with a real oracle/quote.
const MARK = { perps: 100, spot: 100, options: 5, fx: 1 };

export async function submitOrder(order) {
  if (MODE === "live") return submitLive(order);
  return submitMock(order);
}

function submitMock(order) {
  const mark = MARK[order.market] || 100;
  // 5 bps synthetic slippage against the taker
  const slip = order.side === "long" ? 1.0005 : 0.9995;
  const fillPrice = mark * slip;
  const qty = Number(order.notional) / mark;
  return {
    ok: true,
    venue: "mock",
    fill: {
      market: order.market,
      side: order.side,
      notional: Number(order.notional),
      leverage: Number(order.leverage || 1),
      qty,
      fillPrice,
      fee: Number(order.notional) * 0.0004, // 4 bps taker fee
      ts: Date.now(),
      txId: "mock-" + Math.random().toString(16).slice(2, 10),
    },
  };
}

// Generic live venue client: POST the order to the venue's REST API and normalize
// the response into the same fill shape the mock returns. Margin must already have
// been pushed to the venue via MoltbitVault.allocate (the gateway does this through
// the Privy server wallet) — this call only opens the position.
async function submitLive(order) {
  if (!VENUE_API_URL) throw new Error("VENUE_MODE=live but VENUE_API_URL is not set");
  const r = await fetch(VENUE_API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(VENUE_API_KEY ? { authorization: `Bearer ${VENUE_API_KEY}` } : {}),
    },
    body: JSON.stringify({
      market: order.market,
      side: order.side,
      notional: Number(order.notional),
      leverage: Number(order.leverage || 1),
      type: "market",
      reduceOnly: false,
    }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`venue ${r.status}: ${JSON.stringify(body).slice(0, 300)}`);
  return { ok: true, venue: VENUE_NAME, fill: normalizeFill(order, body) };
}

// Map a venue's response onto the canonical fill. Tolerates common field names;
// adapt to your venue's exact schema.
export function normalizeFill(order, body = {}) {
  const fillPrice = Number(body.fillPrice ?? body.avgPrice ?? body.price ?? 0);
  const qty = Number(body.qty ?? body.size ?? body.filledQty ?? (fillPrice ? Number(order.notional) / fillPrice : 0));
  return {
    market: order.market,
    side: order.side,
    notional: Number(order.notional),
    leverage: Number(order.leverage || 1),
    qty,
    fillPrice,
    fee: Number(body.fee ?? body.commission ?? 0),
    ts: Number(body.ts ?? body.timestamp ?? Date.now()),
    txId: String(body.txId ?? body.orderId ?? body.id ?? ""),
  };
}

export const VENUE_MODE = MODE;
