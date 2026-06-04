import { test } from "node:test";
import assert from "node:assert/strict";
import { parseStrategy } from "../lib/strategyParse.js";
import register from "../lib/routes/register-agent.js";

test("parseStrategy derives style/markets/leverage from plain language", () => {
  const p = parseStrategy("Go long ETH perps when funding is negative, hedge with spot, 3x leverage. Conservative.");
  assert.equal(p.style, "funding-rate carry");
  assert.equal(p.markets.perps, true);
  assert.equal(p.markets.spot, true);
  assert.equal(p.maxLeverage, 2); // 3x, nudged down by "conservative"
  assert.ok(p.summary.length > 0);
});

test("parseStrategy clamps leverage to the sandbox ceiling (<=5)", () => {
  const p = parseStrategy("Aggressive momentum breakout trading at 20x leverage");
  assert.equal(p.style, "momentum / trend");
  assert.ok(p.maxLeverage <= 5);
});

test("parseStrategy defaults markets to perps+spot when nothing matches", () => {
  const p = parseStrategy("just do something clever");
  assert.equal(p.markets.perps, true);
  assert.equal(p.markets.spot, true);
  assert.equal(p.markets.options, false);
});

function mkRes() {
  return { _c: 0, _b: null, status(c) { this._c = c; return this; }, json(b) { this._b = b; return this; } };
}

test("register-agent stores a natural-language strategy + derived params", async () => {
  const res = mkRes();
  await register({ method: "POST", headers: {}, body: { strategy: "Delta-neutral long/short pairs on BTC perps, 4x." } }, res);
  assert.equal(res._c, 201);
  assert.equal(res._b.agent.createdBy, "human");
  assert.equal(res._b.agent.strategy, "Delta-neutral long/short pairs on BTC perps, 4x.");
  assert.equal(res._b.agent.style, "delta-neutral");
  assert.ok(res._b.agent.summary);
  assert.ok(res._b.agent.policy.maxLeverage <= 5);
  assert.ok(res._b.agentKey);
});

test("register-agent without a strategy still behaves as before (createdBy=agent)", async () => {
  const res = mkRes();
  await register({ method: "POST", headers: {}, body: { name: "Dev Bot" } }, res);
  assert.equal(res._c, 201);
  assert.equal(res._b.agent.createdBy, "agent");
  assert.equal(res._b.agent.strategy, null);
});
