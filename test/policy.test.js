import { test } from "node:test";
import assert from "node:assert/strict";
import { checkOrder, shouldHalt, toPolicy, DEFAULT_POLICY, clampToSandbox, SANDBOX_LIMITS, ACTIVE_STATUSES } from "../lib/policy.js";

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

test("clampToSandbox caps an over-ambitious policy to the ceilings", () => {
  const p = clampToSandbox(toPolicy({
    maxLeverage: 50, maxPosition: 999999, dailyLoss: 999999, treasuryCap: 99,
    markets: { perps: true, spot: true, options: true, fx: true },
  }));
  assert.equal(p.maxLeverage, SANDBOX_LIMITS.maxLeverage);
  assert.equal(p.maxPosition, SANDBOX_LIMITS.maxPosition);
  assert.equal(p.dailyLoss, SANDBOX_LIMITS.dailyLoss);
  assert.equal(p.treasuryCap, SANDBOX_LIMITS.treasuryCap);
  assert.equal(p.markets.options, false); // exotic markets blocked in sandbox
  assert.equal(p.markets.fx, false);
});

test("clampToSandbox leaves a conservative policy intact", () => {
  const p = clampToSandbox(toPolicy({ maxLeverage: 2, maxPosition: 1000 }));
  assert.equal(p.maxLeverage, 2);
  assert.equal(p.maxPosition, 1000);
});

test("sandbox agents are active for trading; review is not", () => {
  assert.equal(ACTIVE_STATUSES.has("sandbox"), true);
  assert.equal(ACTIVE_STATUSES.has("live"), true);
  assert.equal(ACTIVE_STATUSES.has("review"), false);
  const ok = checkOrder({ market: "perps", notional: 1000, leverage: 2 }, DEFAULT_POLICY, { status: "sandbox", aum: 100000, deployed: 0, dayRealizedPnl: 0 });
  assert.equal(ok.ok, true);
  const denied = checkOrder({ market: "perps", notional: 1000, leverage: 2 }, DEFAULT_POLICY, { status: "review" });
  assert.equal(denied.code, "AGENT_HALTED");
});
