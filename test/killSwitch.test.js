import { test } from "node:test";
import assert from "node:assert/strict";
import { haltAgent, isHalted } from "../lib/killSwitch.js";

test("haltAgent halts, flattens, and records the audit trail", () => {
  const agent = { id: "bot", status: "live", deployed: 250_000, aum: 1.0 };
  const out = haltAgent(agent, { by: "depositor:0xabc", reason: "panic", now: 42 });
  assert.equal(out.status, "halted");
  assert.equal(out.deployed, 0);
  assert.equal(out.haltedAt, 42);
  assert.equal(out.haltedBy, "depositor:0xabc");
  assert.equal(out.haltReason, "panic");
  // does not mutate the input
  assert.equal(agent.status, "live");
  assert.equal(agent.deployed, 250_000);
});

test("isHalted recognises halted and paused states", () => {
  assert.equal(isHalted({ status: "halted" }), true);
  assert.equal(isHalted({ status: "paused" }), true);
  assert.equal(isHalted({ status: "live" }), false);
  assert.equal(isHalted(null), false);
});
