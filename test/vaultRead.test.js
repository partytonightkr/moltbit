import { test } from "node:test";
import assert from "node:assert/strict";
import { formatVaultState, vaultConfigured } from "../lib/vaultRead.js";

test("formatVaultState scales 6dp USDC and 1e6 pps to human numbers", () => {
  const s = formatVaultState({
    pps: 1_200_000n,            // 1.2 NAV
    reportedAssets: 12_000_000_000n, // 12,000 USDC
    totalSupply: 10_000_000_000n,    // 10,000 shares
    pendingLiability: 0n,
    paused: false,
  });
  assert.equal(s.nav, 1.2);
  assert.equal(s.aumUsd, 12000);
  assert.equal(s.aumM, 0.012);
  assert.equal(s.shares, 10000);
  assert.equal(s.paused, false);
});

test("formatVaultState reflects pause + liability", () => {
  const s = formatVaultState({ pps: 1_000_000n, reportedAssets: 5_000_000n, totalSupply: 5_000_000n, pendingLiability: 1_000_000n, paused: true });
  assert.equal(s.nav, 1);
  assert.equal(s.liabilityUsd, 1);
  assert.equal(s.paused, true);
});

test("vaultConfigured is true for testnet (public default RPC)", () => {
  assert.equal(vaultConfigured("test"), true);
});
