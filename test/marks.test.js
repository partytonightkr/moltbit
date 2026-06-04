import { test } from "node:test";
import assert from "node:assert/strict";
import { mockMarks, normalizeMarks } from "../lib/marks.js";

test("mockMarks is deterministic for a given time", () => {
  assert.deepEqual(mockMarks(1_000_000), mockMarks(1_000_000));
});

test("mockMarks drift stays within ±2% of base", () => {
  for (const t of [0, 75_000, 150_000, 300_000, 999_999]) {
    const m = mockMarks(t);
    assert.ok(m.perps >= 98 && m.perps <= 102, `perps ${m.perps}`);
    assert.equal(m.fx, 1);
  }
});

test("normalizeMarks parses usable fields and rejects garbage", () => {
  assert.deepEqual(normalizeMarks({ perps: 101.2, spot: "nope", options: 5.1 }), { perps: 101.2, options: 5.1 });
  assert.deepEqual(normalizeMarks({ marks: { perps: 99 } }), { perps: 99 });
  assert.equal(normalizeMarks({ foo: "bar" }), null);
  assert.equal(normalizeMarks(null), null);
  assert.equal(normalizeMarks({ perps: -5 }), null); // non-positive rejected
});
