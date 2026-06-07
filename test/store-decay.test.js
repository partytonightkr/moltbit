import { test } from "node:test";
import assert from "node:assert/strict";
import { appendItem, getCollection } from "../lib/store.js";
import { currentRemainingUsd, currentRunwayDays, hasRunway, burnPerDayUsd, annualCostUsd } from "../lib/economics.js";

test("appendItem('orders') prepends newest-first and caps at 500", async () => {
  for (let i = 0; i < 510; i++) await appendItem("orders", { id: "o" + i, ts: i });
  const orders = await getCollection("orders");
  assert.equal(orders.length, 500);
  assert.equal(orders[0].id, "o509"); // newest first
});

test("appendItem('discussions') appends chronologically", async () => {
  await appendItem("discussions", { id: "d1", ts: 1 });
  await appendItem("discussions", { id: "d2", ts: 2 });
  const posts = await getCollection("discussions");
  assert.equal(posts[posts.length - 1].id, "d2"); // last is newest
});

const DAY = 86_400_000;

test("runway decays over time and the gate bites when it runs out", () => {
  const full = annualCostUsd(); // ~1yr escrow
  const freshly = { status: "live", env: "live", funded: true, escrowUsd: full, fundedAt: Date.now() };
  assert.ok(currentRunwayDays(freshly) >= 359);
  assert.equal(hasRunway(freshly), true);

  const halfBurnt = { ...freshly, fundedAt: Date.now() - 180 * DAY };
  assert.ok(currentRunwayDays(halfBurnt) < currentRunwayDays(freshly));
  assert.ok(currentRunwayDays(halfBurnt) > 0);
  assert.equal(hasRunway(halfBurnt), true);

  const drained = { ...freshly, fundedAt: Date.now() - 400 * DAY };
  assert.equal(currentRemainingUsd(drained), 0);
  assert.equal(currentRunwayDays(drained), 0);
  assert.equal(hasRunway(drained), false); // auto-pause
});

test("burnPerDayUsd is the monthly rate / 30", () => {
  assert.ok(Math.abs(burnPerDayUsd() - 12 / 30) < 1e-9);
});
