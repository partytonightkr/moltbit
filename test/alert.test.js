import { test } from "node:test";
import assert from "node:assert/strict";
import { alert, ALERT_MODE } from "../lib/alert.js";

test("alert never throws and reports log mode when no webhook is set", async () => {
  // ALERT_WEBHOOK_URL is unset in the test env → log-only delivery
  assert.equal(ALERT_MODE, "log");
  const r = await alert("test.event", { foo: "bar" }, "error");
  assert.equal(r.delivered, false);
  assert.equal(r.mode, "log");
});

test("alert tolerates missing detail", async () => {
  const r = await alert("test.bare");
  assert.equal(r.mode, "log");
});
