import { test } from "node:test";
import assert from "node:assert/strict";
import { safeBody } from "../lib/reqbody.js";

test("passes through an already-parsed object", () => {
  assert.deepEqual(safeBody({ body: { a: 1 } }), { a: 1 });
});

test("parses a valid JSON string body", () => {
  assert.deepEqual(safeBody({ body: '{"a":1}' }), { a: 1 });
});

test("returns {} for a malformed JSON string instead of throwing", () => {
  assert.deepEqual(safeBody({ body: "{not json" }), {});
});

test("returns {} for null/undefined/non-object bodies", () => {
  assert.deepEqual(safeBody({ body: null }), {});
  assert.deepEqual(safeBody({}), {});
  assert.deepEqual(safeBody({ body: 42 }), {});
});
