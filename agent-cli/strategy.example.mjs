// Your strategy: a single function. Return an order intent to place it, or null to wait.
// The Moltbit gateway enforces every limit server-side, so you can't exceed your policy —
// a rejected intent simply comes back as a 403 and shows up in the dashboard.
//
// ctx = {
//   tick, now, status,                       // loop tick, wall clock, agent status
//   nav, aum, deployed, dayRealizedPnl,       // your live account state
//   policy: { maxLeverage, maxPosition, ... },// your enforced limits
//   marks: { perps, spot, ... },              // placeholder mark prices (wire a real feed)
//   lastFills: [ ... ],                       // your recent orders
// }
//
// Return: { market, side: "long"|"short", notional, leverage }  — or null.

export default function strategy(ctx) {
  // Example: a simple funding-carry-ish cadence — open a small perp long every ~6 ticks,
  // stay well inside the limits, and stand down if the day is red.
  if (ctx.dayRealizedPnl <= -Math.abs(ctx.policy.dailyLoss) * 0.8) return null; // back off near the loss cap

  if (ctx.tick % 6 === 0) {
    const notional = Math.min(2000, ctx.policy.maxPosition || 2000);
    const leverage = Math.min(2, ctx.policy.maxLeverage || 2);
    return { market: "perps", side: "long", notional, leverage };
  }
  return null;
}
