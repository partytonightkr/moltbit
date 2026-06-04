import { test } from "node:test";
import assert from "node:assert/strict";
import health from "../lib/routes/health.js";
import register from "../lib/routes/register-agent.js";

function mkRes() {
  return { _c: 0, _b: null, _h: {}, setHeader(k, v) { this._h[k] = v; }, status(c) { this._c = c; return this; }, json(b) { this._b = b; return this; } };
}

test("health reports liveness + wiring (ephemeral in tests)", async () => {
  const res = mkRes();
  await health({ method: "GET" }, res);
  assert.equal(res._c, 200);
  assert.equal(res._b.ok, true);
  assert.equal(res._b.store, "memory");
  assert.equal(res._b.persistent, false);
  assert.equal(res._b.venue, "mock");
  assert.ok(res._b.warning); // ephemeral warning present
});

test("health rejects non-GET", async () => {
  const res = mkRes();
  await health({ method: "POST" }, res);
  assert.equal(res._c, 405);
});

test("register surfaces the ephemeral-store warning + never crashes on a bad body", async () => {
  const res = mkRes();
  await register({ method: "POST", headers: {}, body: "{ this is not json" }, res); // malformed string
  assert.equal(res._c, 201); // safeBody → defaults, no 500
  assert.equal(res._b.agent.status, "sandbox");
  assert.ok(res._b.warning); // memory-store warning
});
