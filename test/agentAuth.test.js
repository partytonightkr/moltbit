import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { mintAgentKey, verifyAgentKey, keyActive, secretConfigured } from "../lib/agentAuth.js";

test("mint → verify round-trips with the key version", () => {
  const key = mintAgentKey("Alpha Bot", "test", 0);
  const v = verifyAgentKey(key);
  assert.equal(v.ok, true);
  assert.equal(v.agentId, "alpha-bot");
  assert.equal(v.env, "test");
  assert.equal(v.kid, 0);
});

test("rotation changes the key version (kid)", () => {
  const k1 = mintAgentKey("bot", "live", 1);
  const v = verifyAgentKey(k1);
  assert.equal(v.kid, 1);
  assert.equal(v.env, "live");
  assert.notEqual(mintAgentKey("bot", "live", 1), mintAgentKey("bot", "live", 2));
});

test("tampered signature is rejected", () => {
  const key = mintAgentKey("bot", "test", 0);
  const bad = key.slice(0, -1) + (key.endsWith("a") ? "b" : "a");
  assert.equal(verifyAgentKey(bad).ok, false);
});

test("malformed keys are rejected", () => {
  assert.equal(verifyAgentKey("nope").ok, false);
  assert.equal(verifyAgentKey("").ok, false);
  assert.equal(verifyAgentKey(null).ok, false);
});

test("legacy keys (no kid) still verify as kid 0", () => {
  // reconstruct the legacy format mbk_<env>_<id>.<sig> with the dev secret
  const secret = process.env.AGENT_SECRET || process.env.AUTH_SECRET || "dev-agent-secret-change-me";
  const id = "legacy-bot";
  const sig = crypto.createHmac("sha256", secret).update(`test:${id}`).digest("hex").slice(0, 48);
  const v = verifyAgentKey(`mbk_test_${id}.${sig}`);
  assert.equal(v.ok, true);
  assert.equal(v.kid, 0);
});

test("keyActive enforces revocation and rotation", () => {
  assert.equal(keyActive({ keyVersion: 0, keyRevoked: false }, 0), true);
  assert.equal(keyActive({ keyVersion: 1, keyRevoked: false }, 0), false); // superseded
  assert.equal(keyActive({ keyVersion: 0, keyRevoked: true }, 0), false); // revoked
  assert.equal(keyActive(undefined, 0), true); // unknown agent → caller decides
});

test("secret is considered configured in non-production dev runs", () => {
  assert.equal(secretConfigured(), true);
});
