import { test } from "node:test";
import assert from "node:assert/strict";
import register from "../lib/routes/register-agent.js";
import markets from "../lib/routes/markets.js";
import { signToken } from "../lib/auth.js";

const OP = "Bearer " + signToken({ role: "operator" });
function mkRes() {
  return { _c: 0, _b: null, status(c) { this._c = c; return this; }, json(b) { this._b = b; return this; } };
}
async function mkAgent(name) {
  const r = mkRes();
  await register({ method: "POST", headers: {}, body: { name, strategy: "spot accumulation" } }, r);
  return r._b;
}

test("GET markets returns an array", async () => {
  const res = mkRes();
  await markets({ method: "GET", query: {} }, res);
  assert.equal(res._c, 200);
  assert.ok(Array.isArray(res._b.markets));
});

test("full lifecycle: create → bet → resolve → payout", async () => {
  const a = await mkAgent("Market Maker");
  const c = mkRes();
  await markets({ method: "POST", headers: { "x-agent-key": a.agentKey }, body: { op: "create" } }, c);
  assert.equal(c._c, 201);
  const id = c._b.market.id;
  assert.equal(c._b.market.status, "open");

  // bets: 300 YES, 100 NO  → pool 400
  let r = mkRes();
  await markets({ method: "POST", headers: {}, body: { op: "bet", marketId: id, side: "yes", amount: 300 } }, r);
  assert.equal(r._c, 200);
  r = mkRes();
  await markets({ method: "POST", headers: {}, body: { op: "bet", marketId: id, side: "no", amount: 100 } }, r);
  assert.equal(r._b.market.vol, 400);
  assert.ok(Math.abs(r._b.market.yesOdds - 0.75) < 1e-9);

  // resolve YES (operator)
  const res = mkRes();
  await markets({ method: "POST", headers: { authorization: OP }, body: { op: "resolve", marketId: id, outcome: "yes" } }, res);
  assert.equal(res._c, 200);
  assert.equal(res._b.market.status, "resolved");
  assert.equal(res._b.market.outcome, "yes");
  // net pool = 400 - 3% = 388; per YES unit = 388/300
  assert.ok(Math.abs(res._b.market.payoutPerUnit - 388 / 300) < 1e-6);
});

test("bet validation + resolve requires operator", async () => {
  const a = await mkAgent("Guarded");
  const c = mkRes();
  await markets({ method: "POST", headers: { "x-agent-key": a.agentKey }, body: { op: "create" } }, c);
  const id = c._b.market.id;

  const bad = mkRes();
  await markets({ method: "POST", headers: {}, body: { op: "bet", marketId: id, side: "maybe", amount: 10 } }, bad);
  assert.equal(bad._c, 400);

  const noauth = mkRes();
  await markets({ method: "POST", headers: {}, body: { op: "resolve", marketId: id, outcome: "yes" } }, noauth);
  assert.ok(noauth._c === 401 || noauth._c === 403);
});
