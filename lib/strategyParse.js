// Deterministic natural-language → trading parameters.
// Turns a plain-language strategy (any language; keyword-matched, lowercased) into
// the structured params an agent registers under. No LLM dependency — fully testable
// and instant. An optional Claude pass can refine this later, but creation never
// blocks on it.

const has = (t, ...words) => words.some((w) => t.includes(w));

export function parseStrategy(text) {
  const t = String(text || "").toLowerCase();

  // --- markets ---
  const markets = {
    perps: has(t, "perp", "perpetual", "futures", "leverage", "long", "short", "funding"),
    spot: has(t, "spot", "hodl", "buy and hold", "accumulate"),
    options: has(t, "option", "call", "put", "covered", "straddle", "vol "),
    fx: has(t, "fx", "forex", "currency", "eur", "jpy"),
  };
  // default to perps+spot if nothing matched
  if (!markets.perps && !markets.spot && !markets.options && !markets.fx) {
    markets.perps = true;
    markets.spot = true;
  }

  // --- style descriptor ---
  let style = "discretionary";
  if (has(t, "funding", "carry", "basis")) style = "funding-rate carry";
  else if (has(t, "market neutral", "delta neutral", "delta-neutral", "neutral")) style = "delta-neutral";
  else if (has(t, "arbitrage", "arb ", " arb")) style = "arbitrage";
  else if (has(t, "momentum", "trend", "breakout")) style = "momentum / trend";
  else if (has(t, "mean revert", "reversion", "revert", "fade")) style = "mean reversion";
  else if (has(t, "option", "vol", "volatility", "straddle")) style = "volatility / options";
  else if (has(t, "grid", "dca", "dollar cost")) style = "systematic / grid";

  // --- leverage: look for "3x", "5 x", "leverage 3" ; clamp 1..5 (sandbox ceiling) ---
  let maxLeverage = 3;
  const m = t.match(/(\d+(?:\.\d+)?)\s*x\b/) || t.match(/leverage\s*(?:of|=|:)?\s*(\d+(?:\.\d+)?)/);
  if (m) maxLeverage = Math.max(1, Math.min(5, Math.round(parseFloat(m[1]))));
  // risk words nudge leverage
  if (has(t, "aggressive", "high risk", "high-risk", "degen")) maxLeverage = Math.min(5, maxLeverage + 1);
  if (has(t, "conservative", "low risk", "low-risk", "safe", "cautious")) maxLeverage = Math.max(1, maxLeverage - 1);

  // --- summary: first sentence / first ~140 chars of the original text ---
  const clean = String(text || "").trim().replace(/\s+/g, " ");
  const firstSentence = clean.split(/(?<=[.!?])\s/)[0] || clean;
  const summary = (firstSentence.length > 140 ? firstSentence.slice(0, 137) + "…" : firstSentence) || "Custom strategy";

  return { style, markets, maxLeverage, summary };
}
