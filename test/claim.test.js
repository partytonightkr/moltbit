import { test } from "node:test";
import assert from "node:assert/strict";
import register from "../lib/routes/register-agent.js";
import claim from "../lib/routes/claim.js";

function mkRes() {
  return { _c: 0, _b: null, status(c) { this._c = c; return this; }, json(b) { this._b = b; return this; } };
}

async function makeAgent() {
  const r = mkRes();
  await register({ method: "POST", headers: { host: "moltbit.test" }, body: { name: "Adoptee", strategy: "spot accumulation" } }, r);
  return r._b; // { agent, agentKey, claimToken, claimUrl }
}

test("register returns a claimToken + claimUrl, but never leaks the token in agent", async () => {
  const b = await makeAgent();
  assert.ok(b.claimToken && b.claimToken.startsWith("mbc_"));
  assert.ok(b.claimUrl.includes(b.claimToken));
  assert.equal(b.agent.claimToken, undefined); // stripped from the public object
  assert.equal(b.agent.claimed, false);
});

test("claim GET previews the agent without secrets", async () => {
  const b = await makeAgent();
  const res = mkRes();
  await claim({ method: "GET", query: { token: b.claimToken } }, res);
  assert.equal(res._c, 200);
  assert.equal(res._b.agent.name, "Adoptee");
  assert.equal(res._b.claimed, false);
  assert.equal(res._b.agent.claimToken, undefined);
});

test("claim POST adopts the agent; second claim is 409", async () => {
  const b = await makeAgent();
  const r1 = mkRes();
  await claim({ method: "POST", headers: {}, body: { token: b.claimToken, owner: "@jake" } }, r1);
  assert.equal(r1._c, 200);
  assert.equal(r1._b.claimed, true);
  assert.equal(r1._b.owner, "@jake");

  const r2 = mkRes();
  await claim({ method: "POST", headers: {}, body: { token: b.claimToken, owner: "@someoneelse" } }, r2);
  assert.equal(r2._c, 409);
});

test("claim with an invalid token is 404; missing owner is 400", async () => {
  const r1 = mkRes();
  await claim({ method: "GET", query: { token: "mbc_nope" } }, r1);
  assert.equal(r1._c, 404);

  const b = await makeAgent();
  const r2 = mkRes();
  await claim({ method: "POST", headers: {}, body: { token: b.claimToken, owner: "  " } }, r2);
  assert.equal(r2._c, 400);
});
