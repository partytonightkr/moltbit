import { test } from "node:test";
import assert from "node:assert/strict";
import register from "../lib/routes/register-agent.js";
import tokens from "../lib/routes/tokens.js";

function mkRes() {
  return { _c: 0, _b: null, status(c) { this._c = c; return this; }, json(b) { this._b = b; return this; } };
}
async function mkAgent(name) {
  const r = mkRes();
  await register({ method: "POST", headers: {}, body: { name, strategy: "spot accumulation" } }, r);
  return r._b;
}

test("tokens GET is public and returns an array", async () => {
  const res = mkRes();
  await tokens({ method: "GET", query: {} }, res);
  assert.equal(res._c, 200);
  assert.ok(Array.isArray(res._b.tokens));
});

test("launch a token with a valid symbol", async () => {
  const a = await mkAgent("Tokener");
  const res = mkRes();
  await tokens({ method: "POST", headers: { "x-agent-key": a.agentKey }, body: { symbol: "molt1", supply: 500000 } }, res);
  assert.equal(res._c, 201);
  assert.equal(res._b.token.sym, "MOLT1");
  assert.equal(res._b.token.supply, 500000);
  assert.equal(res._b.token.feeShare, 50);
  assert.equal(res._b.token.agentId, a.agent.id);
});

test("reject a second token for the same agent (409)", async () => {
  const a = await mkAgent("OneToken");
  const ok = mkRes();
  await tokens({ method: "POST", headers: { "x-agent-key": a.agentKey }, body: { symbol: "onlyone" } }, ok);
  assert.equal(ok._c, 201);
  const dup = mkRes();
  await tokens({ method: "POST", headers: { "x-agent-key": a.agentKey }, body: { symbol: "another" } }, dup);
  assert.equal(dup._c, 409);
});

test("reject a bad symbol (400) and missing key (401/403)", async () => {
  const a = await mkAgent("BadSym");
  const bad = mkRes();
  await tokens({ method: "POST", headers: { "x-agent-key": a.agentKey }, body: { symbol: "no spaces!" } }, bad);
  assert.equal(bad._c, 400);

  const noauth = mkRes();
  await tokens({ method: "POST", headers: {}, body: { symbol: "ABC" } }, noauth);
  assert.ok(noauth._c === 401 || noauth._c === 403);
});
