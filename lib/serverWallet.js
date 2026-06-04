// Server wallet — signs the vault's on-chain actions (e.g. MoltbitVault.allocate
// to push margin to a venue) WITHOUT exposing a private key to the agent.
//
// Production: a Privy SERVER wallet / session signer scoped per strategy, with a
// policy that permits ONLY `allocate(venue, amount)`, `returnFromVenue`, `reportNav`,
// `crank` and `setPaused` on that strategy's vault — never `transfer` to an EOA. The
// agent never holds this key; the gateway invokes it after policy passes.
//
// Calldata is encoded with viem (lib/chainServer.js) and submitted through Privy's
// REST API. Without PRIVY_APP_ID + PRIVY_APP_SECRET this runs in MOCK mode and
// returns a fake tx hash so the whole pipeline still works in dev/testnet demos.
import {
  PRIVY_CONFIGURED, sendVaultTx,
  encodeAllocate, encodeReturnFromVenue, encodeReportNav, encodeCrank, encodeSetPaused,
  encodeAdapterOpen, encodeAdapterClose, encodeAdapterReturnIdle,
} from "./chainServer.js";

const LIVE = PRIVY_CONFIGURED;
export const SERVER_WALLET_MODE = LIVE ? "live" : "mock";

const mockHash = () => "0xmock" + Math.random().toString(16).slice(2, 10);

/**
 * Push margin from a strategy vault to a whitelisted venue (MoltbitVault.allocate).
 * @param {object} args { env, vaultAddress, venue, amountUsdc, walletId }
 * @returns {Promise<{txHash:string, mode:string}>}
 */
export async function allocateToVenue({ env, vaultAddress, venue, amountUsdc, walletId }) {
  if (!LIVE || !vaultAddress) return { txHash: mockHash(), mode: "mock" };
  const data = encodeAllocate(venue, amountUsdc);
  const txHash = await sendVaultTx({ env, walletId, to: vaultAddress, data });
  return { txHash, mode: "live" };
}

/**
 * Push the latest NAV on-chain (MoltbitVault.reportNav) via the server wallet.
 * Mock-safe. Used by the settlement worker each epoch.
 */
export async function reportNavOnchain({ env, vaultAddress, reportedAssets, walletId }) {
  if (!LIVE || !vaultAddress) return { txHash: mockHash(), mode: "mock" };
  const data = encodeReportNav(reportedAssets);
  const txHash = await sendVaultTx({ env, walletId, to: vaultAddress, data });
  return { txHash, mode: "live" };
}

/**
 * Permissionlessly crank expired trade-close windows on-chain (MoltbitVault.crank).
 * Mock-safe.
 */
export async function crankOnchain({ env, vaultAddress, ids, walletId }) {
  if (!LIVE || !vaultAddress || !ids || ids.length === 0) {
    return { txHash: mockHash(), mode: "mock", ids: ids || [] };
  }
  const data = encodeCrank(ids);
  const txHash = await sendVaultTx({ env, walletId, to: vaultAddress, data });
  return { txHash, mode: "live", ids };
}

/**
 * Kill switch — pause the vault on-chain (MoltbitVault.setPaused). Blocks new
 * deposits + agent allocation; exits stay open. The server wallet must hold
 * KEEPER_ROLE or DEFAULT_ADMIN_ROLE for setPaused. Mock-safe.
 */
export async function pauseVaultOnchain({ env, vaultAddress, paused = true, walletId }) {
  if (!LIVE || !vaultAddress) return { txHash: mockHash(), mode: "mock", paused };
  const data = encodeSetPaused(paused);
  const txHash = await sendVaultTx({ env, walletId, to: vaultAddress, data });
  return { txHash, mode: "live", paused };
}

/**
 * Flatten — close open venue positions and return capital to the vault. The venue
 * unwind is submitted via lib/venue.js (flatten); here we book the returned USDC
 * back into the vault via MoltbitVault.returnFromVenue. Mock-safe.
 * @param {object} args { env, vaultAddress, venue, returnedUsdc, walletId }
 */
export async function flattenOnchain({ env, vaultAddress, venue, returnedUsdc = 0, walletId }) {
  if (!LIVE || !vaultAddress) return { txHash: mockHash(), mode: "mock", flattened: true };
  // Only book a return tx if the venue actually freed capital.
  if (Number(returnedUsdc) <= 0) return { txHash: null, mode: "live", flattened: true, returnedUsdc: 0 };
  const data = encodeReturnFromVenue(returnedUsdc);
  const txHash = await sendVaultTx({ env, walletId, to: vaultAddress, data });
  return { txHash, mode: "live", flattened: true, returnedUsdc: Number(returnedUsdc) };
}

// -------------------------------------------------------------------
//  On-chain venue adapter (MoltbitAvantisAdapter) — open/close/return.
//  Margin must already be in the adapter via allocateToVenue(adapter, margin).
// -------------------------------------------------------------------

/**
 * Open a perp position on the adapter (adapter.openTrade). Mock-safe.
 * @param {object} args { env, adapterAddress, walletId, pairIndex, buy, marginUsdc,
 *                        openPrice, leverage, tp, sl, orderType, slippagePct, executionFee }
 */
export async function openVenuePosition({ env, adapterAddress, walletId, ...params }) {
  if (!LIVE || !adapterAddress) return { txHash: mockHash(), mode: "mock" };
  const data = encodeAdapterOpen(params);
  const txHash = await sendVaultTx({ env, walletId, to: adapterAddress, data });
  return { txHash, mode: "live" };
}

/** Close (or partially close) a position on the adapter (adapter.closeTrade). Mock-safe. */
export async function closeVenuePosition({ env, adapterAddress, walletId, ...params }) {
  if (!LIVE || !adapterAddress) return { txHash: mockHash(), mode: "mock" };
  const data = encodeAdapterClose(params);
  const txHash = await sendVaultTx({ env, walletId, to: adapterAddress, data });
  return { txHash, mode: "live" };
}

/** Sweep the adapter's idle USDC back to the vault (adapter.returnIdleToVault). Mock-safe. */
export async function returnIdleFromAdapter({ env, adapterAddress, walletId }) {
  if (!LIVE || !adapterAddress) return { txHash: mockHash(), mode: "mock" };
  const data = encodeAdapterReturnIdle();
  const txHash = await sendVaultTx({ env, walletId, to: adapterAddress, data });
  return { txHash, mode: "live" };
}
