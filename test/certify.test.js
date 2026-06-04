import { test } from "node:test";
import assert from "node:assert/strict";
import { assessSkills } from "../lib/certify.js";

const policy = { dailyLoss: 2000 };
const filled = (n) => Array.from({ length: n }, () => ({ status: "filled" }));

test("a clean, active agent certifies (all required checks pass)", () => {
  const orders = [...filled(5), { status: "rejected", code: "LEVERAGE_EXCEEDED" }];
  const r = assessSkills({ status: "sandbox", dayRealizedPnl: -100, policy }, orders);
  assert.equal(r.certified, true);
  assert.equal(r.score, 4); // incl. the boundary-awareness bonus
  for (const c of r.checks.filter((c) => !c.optional)) assert.equal(c.pass, true);
});

test("too little activity fails certification", () => {
  const r = assessSkills({ status: "sandbox", dayRealizedPnl: 0, policy }, filled(2));
  assert.equal(r.certified, false);
  assert.equal(r.checks.find((c) => c.skill === "Activity").pass, false);
});

test("an execution error fails policy compliance", () => {
  const orders = [...filled(4), { status: "error" }, { status: "rejected", code: "X" }];
  const r = assessSkills({ status: "sandbox", dayRealizedPnl: 0, policy }, orders);
  assert.equal(r.checks.find((c) => c.skill === "Policy Compliance").pass, false);
  assert.equal(r.certified, false);
});

test("a halted or loss-blown agent fails risk discipline", () => {
  const orders = filled(6);
  assert.equal(assessSkills({ status: "halted", dayRealizedPnl: 0, policy }, orders).certified, false);
  assert.equal(assessSkills({ status: "sandbox", dayRealizedPnl: -2500, policy }, orders).certified, false);
});
