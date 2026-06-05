import { test } from "node:test";
import assert from "node:assert/strict";
import discuss from "../lib/routes/discuss.js";
import register from "../lib/routes/register-agent.js";

function mkRes() {
  return { _c: 0, _b: null, status(c) { this._c = c; return this; }, json(b) { this._b = b; return this; } };
}

test("register-agent stores feeWallet (valid 0x) + platform + display", async () => {
  const res = mkRes();
  await register({ method: "POST", headers: {}, body: {
    name: "Carry Bot", strategy: "delta-neutral funding carry on perps",
    feeWallet: "0x" + "a".repeat(40), venue: "Avantis", display: { positions: false },
  } }, res);
  assert.equal(res._c, 201);
  assert.equal(res._b.agent.feeWallet, "0x" + "a".repeat(40));
  assert.equal(res._b.agent.platform, "Avantis");
  assert.equal(res._b.agent.display.positions, false);
  assert.equal(res._b.agent.display.pnlChart, true);
});

test("register-agent rejects a malformed feeWallet by storing null", async () => {
  const res = mkRes();
  await register({ method: "POST", headers: {}, body: { strategy: "momentum trend on perps", feeWallet: "not-an-address" } }, res);
  assert.equal(res._c, 201);
  assert.equal(res._b.agent.feeWallet, null);
});

test("discuss: GET is public and returns a posts array", async () => {
  const res = mkRes();
  await discuss({ method: "GET", query: {} }, res);
  assert.equal(res._c, 200);
  assert.ok(Array.isArray(res._b.posts));
});

test("discuss: POST without an agent key is rejected", async () => {
  const res = mkRes();
  await discuss({ method: "POST", headers: {}, body: { message: "hi" } }, res);
  assert.ok(res._c === 401 || res._c === 403); // requireAgent denies
});

test("discuss: POST with a fresh agent key adds a post", async () => {
  // create an agent and use its key
  const rreg = mkRes();
  await register({ method: "POST", headers: {}, body: { name: "Talker", strategy: "spot accumulation" } }, rreg);
  const key = rreg._b.agentKey;
  assert.ok(key);

  const res = mkRes();
  await discuss({ method: "POST", headers: { "x-agent-key": key }, body: { thread: "general", message: "gm, just opened a spot ladder" } }, res);
  assert.equal(res._c, 201);
  assert.equal(res._b.post.message, "gm, just opened a spot ladder");
  assert.equal(res._b.post.thread, "general");
  assert.equal(res._b.post.agentName, "Talker");
});

test("discuss: empty message is rejected 400", async () => {
  const rreg = mkRes();
  await register({ method: "POST", headers: {}, body: { name: "Mute", strategy: "spot accumulation" } }, rreg);
  const res = mkRes();
  await discuss({ method: "POST", headers: { "x-agent-key": rreg._b.agentKey }, body: { message: "  " } }, res);
  assert.equal(res._c, 400);
});
