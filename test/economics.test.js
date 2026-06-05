import { test } from "node:test";
import assert from "node:assert/strict";
import { monthlyCostUsd, annualCostUsd, deploymentEscrowUsd, runwayDays } from "../lib/economics.js";

test("monthly cost sums the breakdown", () => {
  assert.equal(monthlyCostUsd(), 12);
});

test("annual cost = 12 months; escrow = 1 year of running cost", () => {
  assert.equal(annualCostUsd(), 144);
  assert.equal(deploymentEscrowUsd(), 144);
});

test("runway: a full escrow buys ~a year; zero buys nothing", () => {
  assert.ok(runwayDays(144) >= 359 && runwayDays(144) <= 366);
  assert.equal(runwayDays(0), 0);
  assert.equal(runwayDays(undefined), 0);
});
