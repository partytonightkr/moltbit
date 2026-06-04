import { test } from "node:test";
import assert from "node:assert/strict";
import register from "../api/register-agent.js";
import { SANDBOX_LIMITS } from "../lib/policy.js";

function mkRes() {
  return { _c: 0, _b: null, status(c) { this._c = c; return this; }, json(b) { this._b = b; return this; } };
}
async function call(body, method = "POST") {
  const res = mkRes();
  await register({ method, headers: {}, body }, res);
  return { status: res._c, body: res._b };
}

test("permissionless register creates a clamped sandbox agent + one-time key", async () => {
  const r = await call({ name: "Test Bot", maxLeverage: 50, maxPosition: 1e9, dailyLoss: 1e9, treasuryCap: 99, markets: { perps: true, spot: true, options: true, fx: true } });
  assert.equal(r.status, 201);
  assert.equal(r.body.agent.status, "sandbox");
  assert.equal(r.body.agent.env, "test");
  assert.equal(r.body.agent.vaultAddress, null); // no real funds for sandbox
  assert.equal(r.body.agent.adapterAddress, null);
  // key returned once, scoped to test env + this id, version 0
  assert.match(r.body.agentKey, /^mbk_test_test-bot-[a-z0-9]{1,6}\.0\.[a-f0-9]{48}$/);
  // policy clamped to the ceilings
  assert.equal(r.body.agent.policy.maxLeverage, SANDBOX_LIMITS.maxLeverage);
  assert.equal(r.body.agent.policy.maxPosition, SANDBOX_LIMITS.maxPosition);
  assert.equal(r.body.agent.policy.markets.options, false);
  // key is NOT echoed inside the agent object
  assert.equal("agentKey" in r.body.agent, false);
  // limits surfaced to the caller
  assert.equal(r.body.limits.maxPosition, SANDBOX_LIMITS.maxPosition);
});

test("two registrations of the same name get distinct ids (no squatting)", async () => {
  const a = await call({ name: "Dup" });
  const b = await call({ name: "Dup" });
  assert.notEqual(a.body.agent.id, b.body.agent.id);
});

test("non-POST is rejected", async () => {
  const r = await call(null, "GET");
  assert.equal(r.status, 405);
});
