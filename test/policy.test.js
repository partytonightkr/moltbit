import { test } from "node:test";
import assert from "node:assert/strict";
import { checkOrder, shouldHalt, toPolicy, DEFAULT_POLICY } from "../lib/policy.js";

const liveState = { status: "live", aum: 1_000_000, deployed: 0, dayRealizedPnl: 0 };

test("allows a compliant order", () => {
  const v = checkOrder({ market: "perps", side: "long", notional: 10_000, leverage: 3 }, DEFAULT_POLICY, liveState);
  assert.equal(v.ok, true);
});

test("denies when agent is not live (kill switch / halt)", () => {
  const v = checkOrder({ market: "perps", notional: 1000, leverage: 1 }, DEFAULT_POLICY, { ...liveState, status: "halted" });
  assert.equal(v.ok, false);
  assert.equal(v.code, "AGENT_HALTED");
});

test("denies a disallowed market", () => {
  const v = checkOrder({ market: "options", notional: 1000, leverage: 1 }, DEFAULT_POLICY, liveState);
  assert.equal(v.code, "MARKET_BLOCKED");
});

test("denies leverage over cap", () => {
  const v = checkOrder({ market: "perps", notional: 1000, leverage: 99 }, DEFAULT_POLICY, liveState);
  assert.equal(v.code, "LEVERAGE_EXCEEDED");
});

test("denies notional over per-position cap", () => {
  const v = checkOrder({ market: "perps", notional: 10_000_000, leverage: 1 }, DEFAULT_POLICY, liveState);
  assert.equal(v.code, "POSITION_TOO_LARGE");
});

test("enforces the treasury cap on deployed margin", () => {
  // 40% of 1,000,000 AUM = 400,000 cap; already 390,000 deployed; +20,000 margin breaches
  const p = toPolicy({ treasuryCap: 40, maxPosition: 1_000_000, maxLeverage: 10 });
  const v = checkOrder({ market: "perps", notional: 20_000, leverage: 1 }, p, { ...liveState, deployed: 390_000 });
  assert.equal(v.code, "TREASURY_CAP");
});

test("halts once daily loss limit is breached", () => {
  const v = checkOrder({ market: "perps", notional: 1000, leverage: 1 }, DEFAULT_POLICY, { ...liveState, dayRealizedPnl: -6000 });
  assert.equal(v.code, "DAILY_LOSS_HALT");
  assert.equal(shouldHalt(DEFAULT_POLICY, -6000), true);
  assert.equal(shouldHalt(DEFAULT_POLICY, -100), false);
});

test("toPolicy fills defaults and clamps bad input", () => {
  const p = toPolicy({ maxLeverage: -3, maxPosition: "abc" });
  assert.equal(p.maxLeverage, DEFAULT_POLICY.maxLeverage);
  assert.equal(p.maxPosition, DEFAULT_POLICY.maxPosition);
});
