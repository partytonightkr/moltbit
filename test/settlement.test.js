import { test } from "node:test";
import assert from "node:assert/strict";
import {
  strikeDeposit, requestWithdrawal, closeTrades, claim, tick, reconcile, checkCircuit,
  TRADE_CLOSE_MS, CLAIM_MS,
} from "../lib/settlement.js";

test("strikeDeposit mints shares at NAV", () => {
  const e = strikeDeposit({ type: "deposit", status: "pending", amount: 1200 }, 1.2);
  assert.equal(e.status, "settled");
  assert.equal(e.shares, 1000);
  assert.equal(e.navAt, 1.2);
});

test("withdrawal lifecycle: request → close → claim windows", () => {
  const t0 = 1_000_000;
  let e = requestWithdrawal({ type: "withdrawal", status: "pending", amount: 500 }, 1.0);
  assert.equal(e.status, "settling");
  e = closeTrades(e);
  assert.equal(e.status, "claimable");

  // cannot claim before the window elapses
  const tooEarly = claim(e, e.claimDeadline - 1);
  assert.equal(tooEarly.status, "claimable");
  assert.ok(tooEarly.error);

  // claims after the window
  const done = claim(e, e.claimDeadline + 1);
  assert.equal(done.status, "settled");
  assert.ok(t0 < TRADE_CLOSE_MS + CLAIM_MS + t0); // sanity on the constants
});

test("tick force-closes settling withdrawals past their trade-close deadline", () => {
  const now = Date.now();
  const ledger = [
    { id: "a", type: "withdrawal", status: "settling", closeDeadline: now - 1 },
    { id: "b", type: "withdrawal", status: "settling", closeDeadline: now + 10_000 },
  ];
  const out = tick(ledger, now);
  assert.equal(out.find((e) => e.id === "a").status, "claimable");
  assert.equal(out.find((e) => e.id === "b").status, "settling");
});

test("reconcile balances when Σ shares × NAV == reported AUM", () => {
  const ok = reconcile([{ id: "x", shares: 1_000_000, nav: 1.0, aum: 1.0 }]); // 1M shares * 1.0 == 1.0 * 1e6
  assert.equal(ok.balanced, true);

  const broken = reconcile([{ id: "y", shares: 2_000_000, nav: 1.0, aum: 1.0 }]);
  assert.equal(broken.balanced, false);
});

test("circuit breaker halts on drawdown beyond the threshold", () => {
  const halted = checkCircuit({ ddHalt: 20, status: "live" }, -25);
  assert.equal(halted.status, "halted");
  assert.equal(halted.tripped, true);

  const fine = checkCircuit({ ddHalt: 20, status: "live" }, -10);
  assert.equal(fine.status, "live");
  assert.equal(fine.tripped, false);
});
