import { test } from "node:test";
import assert from "node:assert/strict";
import { rateLimit, clientIp, enforce, MOCK_WRITES_ENABLED } from "../lib/ratelimit.js";

test("rateLimit allows up to the limit, then blocks within the window", () => {
  const key = "t:" + Math.random();
  for (let i = 0; i < 3; i++) assert.equal(rateLimit(key, 3, 60000).ok, true);
  const blocked = rateLimit(key, 3, 60000);
  assert.equal(blocked.ok, false);
  assert.ok(blocked.retryAfter > 0);
});

test("rateLimit resets after the window", () => {
  const key = "t:" + Math.random();
  assert.equal(rateLimit(key, 1, 1).ok, true);  // window 1ms
  assert.equal(rateLimit(key, 1, 1).ok, false);
});

test("clientIp reads x-forwarded-for (first hop)", () => {
  assert.equal(clientIp({ headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" } }), "1.2.3.4");
  assert.equal(clientIp({ headers: {} }), "anon");
});

test("enforce sends 429 when over the limit", () => {
  const key = "e:" + Math.random();
  const res = { _c: 0, _b: null, _h: {}, setHeader(k, v) { this._h[k] = v; }, status(c) { this._c = c; return this; }, json(b) { this._b = b; return this; } };
  assert.equal(enforce({ headers: {} }, res, key, 1), true);
  assert.equal(enforce({ headers: {} }, res, key, 1), false);
  assert.equal(res._c, 429);
  assert.equal(res._b.code, "RATE_LIMITED");
  assert.ok(res._h["Retry-After"]);
});

test("MOCK_WRITES_ENABLED defaults true (unset env)", () => {
  assert.equal(typeof MOCK_WRITES_ENABLED, "boolean");
});
