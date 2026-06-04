import { test } from "node:test";
import assert from "node:assert/strict";
import graduate from "../api/graduate.js";
import { signToken } from "../lib/auth.js";
import { verifyAgentKey } from "../lib/agentAuth.js";
import { getCollection, setCollection } from "../lib/store.js";

const OP = "Bearer " + signToken({ role: "operator" });
function mkRes() { return { _c: 0, _b: null, status(c) { this._c = c; return this; }, json(b) { this._b = b; return this; } }; }
async function call(headers, body) {
  const res = mkRes();
  await graduate({ method: "POST", headers, body }, res);
  return { status: res._c, body: res._b };
}
async function seed(agent) {
  const all = await getCollection("agents");
  await setCollection("agents", [{ keyVersion: 0, policy: { maxLeverage: 5 }, ...agent }, ...all.filter((a) => a.id !== agent.id)]);
}

test("requires operator auth", async () => {
  const r = await call({}, { agentId: "x" });
  assert.equal(r.status, 401);
});

test("refuses to graduate an uncertified agent", async () => {
  await seed({ id: "grad-uncert", status: "sandbox", certified: false });
  const r = await call({ authorization: OP }, { agentId: "grad-uncert", vaultAddress: "0xabc" });
  assert.equal(r.status, 403);
  assert.match(r.body.error, /not certified/);
});

test("requires a vault address", async () => {
  await seed({ id: "grad-novault", status: "sandbox", certified: true });
  const r = await call({ authorization: OP }, { agentId: "grad-novault" });
  assert.equal(r.status, 400);
});

test("graduates a certified agent: live status, wired vault, fresh live key", async () => {
  await seed({ id: "grad-ok", status: "sandbox", certified: true, env: "test", keyVersion: 0 });
  const r = await call({ authorization: OP }, {
    agentId: "grad-ok", vaultAddress: "0xVault", adapterAddress: "0xAdapter",
    serverWalletId: "sw_1", pairIndex: 0, policy: { maxLeverage: 10, maxPosition: 100000 },
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.agent.status, "live");
  assert.equal(r.body.agent.env, "live");
  assert.equal(r.body.agent.vaultAddress, "0xVault");
  assert.equal(r.body.agent.venueKind, "onchain"); // adapter present
  assert.equal(r.body.agent.policy.maxLeverage, 10); // operator live caps, NOT sandbox-clamped
  assert.equal(r.body.agent.keyVersion, 1);
  // fresh live key returned once, supersedes the old one
  assert.match(r.body.agentKey, /^mbk_live_grad-ok\.1\./);
  const v = verifyAgentKey(r.body.agentKey);
  assert.equal(v.ok, true);
  assert.equal(v.env, "live");
  assert.equal("agentKey" in r.body.agent, false);
});
