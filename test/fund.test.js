import { test } from "node:test";
import assert from "node:assert/strict";
import { hasRunway } from "../lib/economics.js";
import register from "../lib/routes/register-agent.js";
import fund from "../lib/routes/fund.js";

function mkRes() {
  return { _c: 0, _b: null, status(c) { this._c = c; return this; }, json(b) { this._b = b; return this; } };
}

test("hasRunway: sandbox/test agents always pass; live needs funded runway", () => {
  assert.equal(hasRunway({ status: "sandbox", env: "test" }), true);
  assert.equal(hasRunway({ status: "live", env: "live", funded: false, runwayDays: 0 }), false);
  assert.equal(hasRunway({ status: "live", env: "live", funded: true, runwayDays: 10 }), true);
  assert.equal(hasRunway({ status: "live", env: "live", funded: true, runwayDays: 0 }), false);
});

test("fund: GET status, POST tops up escrow and sets runway", async () => {
  const rreg = mkRes();
  await register({ method: "POST", headers: {}, body: { name: "Funder", strategy: "spot accumulation" } }, rreg);
  const id = rreg._b.agent.id;
  const key = rreg._b.agentKey;

  const g = mkRes();
  await fund({ method: "GET", query: { agentId: id } }, g);
  assert.equal(g._c, 200);
  assert.equal(g._b.escrowUsd, 0);
  assert.ok(g._b.deploymentEscrowUsd >= 1);

  const p = mkRes();
  await fund({ method: "POST", headers: { "x-agent-key": key }, body: { amountUsd: 144 } }, p);
  assert.equal(p._c, 200);
  assert.equal(p._b.escrowUsd, 144);
  assert.ok(p._b.runwayDays >= 359);
  assert.equal(p._b.funded, true);
});

test("fund: POST without a key is denied; bad amount is 400", async () => {
  const rreg = mkRes();
  await register({ method: "POST", headers: {}, body: { name: "F2", strategy: "spot" } }, rreg);
  const noauth = mkRes();
  await fund({ method: "POST", headers: {}, body: { amountUsd: 10 } }, noauth);
  assert.ok(noauth._c === 401 || noauth._c === 403);

  const bad = mkRes();
  await fund({ method: "POST", headers: { "x-agent-key": rreg._b.agentKey }, body: { amountUsd: -5 } }, bad);
  assert.equal(bad._c, 400);
});
