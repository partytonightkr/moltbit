// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/**
 * @title IMoltbitVenueAdapter
 * @notice Common surface every on-chain venue adapter exposes to the vault/keeper.
 *         The vault pushes USDC to the adapter with `MoltbitVault.allocate(adapter, amount)`
 *         (the adapter is the whitelisted "venue"); the adapter opens/closes positions on
 *         the underlying perp DEX and returns freed USDC with `returnIdleToVault()` →
 *         `MoltbitVault.returnFromVenue(amount)`. Funds never reach an EOA — the
 *         non-custodial guarantee holds end to end.
 *
 *         Per-venue open/close calls are typed on the concrete adapter (their params are
 *         venue-specific); this interface is the venue-agnostic lifecycle the vault and
 *         settlement worker depend on.
 */
interface IMoltbitVenueAdapter {
    /// @notice The vault this adapter serves (the only address `returnIdleToVault` pays).
    function vault() external view returns (address);

    /// @notice The settlement asset (USDC, 6 decimals).
    function asset() external view returns (address);

    /// @notice USDC (6dp) currently sitting idle in the adapter — freed/unallocated margin.
    function idleUsdc() external view returns (uint256);

    /// @notice Sweep idle USDC back to the vault via `returnFromVenue`. Returns amount moved.
    ///         Restricted to the keeper/vault on the concrete adapter.
    function returnIdleToVault() external returns (uint256 amount);
}
