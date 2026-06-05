import { test } from "node:test";
import assert from "node:assert/strict";
import register from "../lib/routes/register-agent.js";
import tokens from "../lib/routes/tokens.js";
import mine from "../lib/routes/mine.js";

function mkRes() {
  return { _c: 0, _b: null, status(c) { this._c = c; return this; }, json(b) { this._b = b; return this; } };
}
async function mkAgent(name) {
  const r = mkRes();
  await register({ method: "POST", headers: {}, body: { name, strategy: "spot" } }, r);
  return r._b;
}

test("mining is gated: no token → 403", async () => {
  const a = await mkAgent("NoToken Miner");
  const res = mkRes();
  await mine({ method: "POST", headers: {}, body: { op: "stake", agentId: a.agent.id, amount: 100, by: "u1" } }, res);
  assert.equal(res._c, 403);
  assert.equal(res._b.code, "NO_TOKEN");
});

test("stake + unstake once a token exists", async () => {
  const a = await mkAgent("Miner");
  const t = mkRes();
  await tokens({ method: "POST", headers: { "x-agent-key": a.agentKey }, body: { symbol: "mine1" } }, t);
  assert.equal(t._c, 201);

  const s = mkRes();
  await mine({ method: "POST", headers: {}, body: { op: "stake", agentId: a.agent.id, amount: 250, by: "u1" } }, s);
  assert.equal(s._c, 200);
  assert.equal(s._b.pool.total, 250);
  assert.equal(s._b.pool.yourStake, 250);
  assert.equal(s._b.pool.stakers, 1);

  const u = mkRes();
  await mine({ method: "POST", headers: {}, body: { op: "unstake", agentId: a.agent.id, amount: 100, by: "u1" } }, u);
  assert.equal(u._b.pool.total, 150);
  assert.equal(u._b.pool.yourStake, 150);
});

test("GET pool status", async () => {
  const a = await mkAgent("Miner Status");
  const g = mkRes();
  await mine({ method: "GET", query: { agentId: a.agent.id } }, g);
  assert.equal(g._c, 200);
  assert.equal(g._b.pool.total, 0);
  assert.ok(g._b.pool.aprPct >= 1);
});
