// Launchpool earnings distribution — how profits split across participants.
//
// A strategy's vault pools USDC. Each participant holds SHARES minted at the NAV when
// they deposited. The price-per-share (pps = totalAssets / totalShares) rises as the
// strategy earns. A participant's value is always `shares × pps` — so profits divide
// strictly PRO-RATA by shares, automatically. The manager (the agent operator) earns a
// PERFORMANCE FEE on gains above the high-water mark; that fee dilutes the pool by exactly
// the fee, mirroring `MoltbitVault._accruePerfFee` on-chain.
//
// This module is the off-chain mirror used for previews/statements; the contract is the
// source of truth.

/**
 * Distribute one epoch across participants.
 * @param {object} args
 *   totalAssetsUsd  current pool value (USD)
 *   totalShares     total shares outstanding (same unit as participant shares)
 *   hwmPps          high-water-mark price-per-share (fee only applies above this)
 *   perfFeeBps      performance fee in basis points (1000 = 10%)
 *   participants    [{ id, shares }]
 * @returns {{ grossPps, netPps, feeUsd, netAssetsUsd, newHwmPps, rows }}
 */
export function distributeEpoch({ totalAssetsUsd, totalShares, hwmPps = 1, perfFeeBps = 1000, participants = [] }) {
  const assets = Math.max(0, Number(totalAssetsUsd || 0));
  const shares = Math.max(0, Number(totalShares || 0));
  const grossPps = shares > 0 ? assets / shares : 1;

  // performance fee on the gain above the high-water mark
  const gainPerShare = Math.max(0, grossPps - Number(hwmPps || 0));
  const feeUsd = gainPerShare * shares * (Number(perfFeeBps || 0) / 10_000);
  const netAssetsUsd = assets - feeUsd;
  const netPps = shares > 0 ? netAssetsUsd / shares : 1;

  const rows = participants.map((p) => {
    const sh = Math.max(0, Number(p.shares || 0));
    const frac = shares > 0 ? sh / shares : 0;
    return {
      id: p.id,
      shares: sh,
      share: frac, // fraction of the pool
      valueUsd: sh * netPps, // their stake net of the fee
    };
  });

  return {
    grossPps,
    netPps,
    feeUsd, // goes to the manager/agent
    netAssetsUsd,
    newHwmPps: Math.max(Number(hwmPps || 0), grossPps), // HWM never goes down
    rows,
  };
}

/**
 * Convert a deposit into shares at the current NAV (mirrors strikeDeposit / vault.deposit).
 * @returns shares minted
 */
export function sharesForDeposit(amountUsd, pps) {
  const price = Number(pps || 1) || 1;
  return Number(amountUsd || 0) / price;
}

/** What a holding is worth right now. */
export function valueOfShares(shares, pps) {
  return Number(shares || 0) * Number(pps || 1);
}
