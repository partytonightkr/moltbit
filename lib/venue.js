// Venue adapter — where validated orders actually execute.
// This is the seam between the gateway and a real trading venue (perp DEX,
// CEX via API, on-chain options, etc). The gateway calls submit(); swap this
// implementation for a real venue client without touching policy/auth code.
//
// MOCK MODE (default): simulates a fill at a synthetic price with deterministic
// slippage so the rest of the pipeline (ledger, NAV, daily-loss) works end-to-end.
// Set VENUE_MODE=live and implement submitLive() against your venue's API.

const MODE = process.env.VENUE_MODE || "mock";

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

// eslint-disable-next-line no-unused-vars
async function submitLive(order) {
  // TODO: integrate the real venue.
  //  - sign/submit via the venue API or an on-chain perp DEX
  //  - margin must be funded from the strategy's MoltbitVault.allocate(venue, margin)
  //    using the Privy SERVER wallet (see lib/serverWallet.js) — never an EOA key
  //  - return a normalized fill { qty, fillPrice, fee, txId }
  throw new Error("VENUE_MODE=live not implemented — wire your venue client here");
}

export const VENUE_MODE = MODE;
