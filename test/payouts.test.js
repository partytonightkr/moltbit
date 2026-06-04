import { test } from "node:test";
import assert from "node:assert/strict";
import { distributeEpoch, sharesForDeposit, valueOfShares } from "../lib/payouts.js";

test("profits divide strictly pro-rata by shares", () => {
  // pool grew 10k → 12k, no fee; two holders 75% / 25%
  const r = distributeEpoch({
    totalAssetsUsd: 12000, totalShares: 10000, hwmPps: 1.2, perfFeeBps: 0,
    participants: [{ id: "a", shares: 7500 }, { id: "b", shares: 2500 }],
  });
  assert.equal(r.feeUsd, 0);
  assert.equal(r.netPps, 1.2);
  const a = r.rows.find((x) => x.id === "a");
  const b = r.rows.find((x) => x.id === "b");
  assert.equal(a.valueUsd, 9000); // 75% of 12k
  assert.equal(b.valueUsd, 3000); // 25% of 12k
  // conservation: Σ value + fee == assets
  assert.ok(Math.abs(a.valueUsd + b.valueUsd + r.feeUsd - 12000) < 1e-6);
});

test("performance fee is taken on gains above the high-water mark", () => {
  // 10k shares, pps rose 1.0 → 1.2 (HWM 1.0), 10% fee on the +2000 gain = 200
  const r = distributeEpoch({
    totalAssetsUsd: 12000, totalShares: 10000, hwmPps: 1.0, perfFeeBps: 1000,
    participants: [{ id: "a", shares: 10000 }],
  });
  assert.ok(Math.abs(r.feeUsd - 200) < 1e-6);
  assert.ok(Math.abs(r.netAssetsUsd - 11800) < 1e-6);
  assert.ok(Math.abs(r.rows[0].valueUsd - 11800) < 1e-6);
  assert.equal(r.newHwmPps, 1.2);
  // conservation holds with the fee
  assert.ok(Math.abs(r.rows[0].valueUsd + r.feeUsd - 12000) < 1e-6);
});

test("no fee when below the high-water mark", () => {
  const r = distributeEpoch({
    totalAssetsUsd: 9000, totalShares: 10000, hwmPps: 1.2, perfFeeBps: 1000,
    participants: [{ id: "a", shares: 10000 }],
  });
  assert.equal(r.feeUsd, 0);
  assert.equal(r.newHwmPps, 1.2); // HWM unchanged (never drops)
  assert.equal(r.rows[0].valueUsd, 9000);
});

test("deposit mints shares at NAV; value round-trips", () => {
  const shares = sharesForDeposit(12000, 1.2); // 10k shares
  assert.equal(shares, 10000);
  assert.equal(valueOfShares(shares, 1.2), 12000);
});
