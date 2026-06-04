import { test } from "node:test";
import assert from "node:assert/strict";
import { signToken, verifyToken, secretConfigured } from "../lib/auth.js";

test("sign → verify round-trips a payload", () => {
  const t = signToken({ role: "operator", org: "X" });
  const p = verifyToken(t);
  assert.equal(p.role, "operator");
  assert.equal(p.org, "X");
  assert.ok(p.exp > Date.now());
});

test("tampered token is rejected", () => {
  const t = signToken({ role: "operator" });
  const bad = t.slice(0, -1) + (t.endsWith("a") ? "b" : "a");
  assert.equal(verifyToken(bad), null);
});

test("malformed tokens are rejected", () => {
  assert.equal(verifyToken("nope"), null);
  assert.equal(verifyToken(""), null);
  assert.equal(verifyToken(null), null);
});

test("secret is considered configured in non-production dev runs", () => {
  // not production here → always true (so dev/tests work with the default secret)
  assert.equal(secretConfigured(), true);
});
