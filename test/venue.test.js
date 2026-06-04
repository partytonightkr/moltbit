import { test } from "node:test";
import assert from "node:assert/strict";
import { submitOrder, normalizeFill, VENUE_MODE } from "../lib/venue.js";

const order = { market: "perps", side: "long", notional: 10_000, leverage: 3 };

test("defaults to mock mode and returns a canonical fill", async () => {
  assert.equal(VENUE_MODE, "mock");
  const r = await submitOrder(order);
  assert.equal(r.ok, true);
  assert.equal(r.venue, "mock");
  assert.equal(r.fill.notional, 10_000);
  assert.ok(r.fill.fillPrice > 0);
  assert.ok(r.fill.qty > 0);
});

test("normalizeFill maps common venue field names", () => {
  const f = normalizeFill(order, { avgPrice: 101, filledQty: 99, commission: 4, orderId: "abc" });
  assert.equal(f.fillPrice, 101);
  assert.equal(f.qty, 99);
  assert.equal(f.fee, 4);
  assert.equal(f.txId, "abc");
  assert.equal(f.market, "perps");
});

test("normalizeFill derives qty from price when size is absent", () => {
  const f = normalizeFill(order, { price: 100 }); // 10_000 / 100 = 100
  assert.equal(f.qty, 100);
});
