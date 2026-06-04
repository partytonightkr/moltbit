// Server wallet — signs the vault's on-chain actions (e.g. MoltbitVault.allocate
// to push margin to a venue) WITHOUT exposing a private key to the agent.
//
// Production: a Privy SERVER wallet / session signer scoped per strategy, with a
// policy that permits ONLY `allocate(venue, amount)` and `returnFromVenue` on that
// strategy's vault — never `transfer` to an EOA. The agent never holds this key;
// the gateway invokes it after policy passes.
//
// Without PRIVY_APP_SECRET set, this runs in MOCK mode and returns a fake tx hash
// so the pipeline works in dev. Implement signAllocate() against the Privy server
// SDK (@privy-io/server-auth) to go real.

const APP_ID = process.env.PRIVY_APP_ID || process.env.VITE_PRIVY_APP_ID;
const APP_SECRET = process.env.PRIVY_APP_SECRET;
const LIVE = !!(APP_ID && APP_SECRET);

/**
 * Push margin from a strategy vault to a whitelisted venue.
 * @param {object} args { env, vaultAddress, venue, amountUsdc, walletId }
 * @returns {Promise<{txHash:string, mode:string}>}
 */
export async function allocateToVenue({ env, vaultAddress, venue, amountUsdc, walletId }) {
  if (!LIVE) {
    return { txHash: "0xmock" + Math.random().toString(16).slice(2, 10), mode: "mock" };
  }
  return signAllocateLive({ env, vaultAddress, venue, amountUsdc, walletId });
}

// eslint-disable-next-line no-unused-vars
async function signAllocateLive({ env, vaultAddress, venue, amountUsdc, walletId }) {
  // TODO: with @privy-io/server-auth:
  //   const privy = new PrivyClient(APP_ID, APP_SECRET);
  //   encode MoltbitVault.allocate(venue, parseUnits(amountUsdc,6))
  //   const { hash } = await privy.walletApi.ethereum.sendTransaction({
  //     walletId, caip2: env === 'live' ? 'eip155:8453' : 'eip155:84532',
  //     transaction: { to: vaultAddress, data, value: 0 },
  //   });
  //   return { txHash: hash, mode: 'live' };
  throw new Error("Privy server wallet not configured — set PRIVY_APP_SECRET");
}

export const SERVER_WALLET_MODE = LIVE ? "live" : "mock";

/**
 * Push the latest NAV on-chain (MoltbitVault.reportNav) via the server wallet.
 * Mock-safe. Used by the settlement worker each epoch.
 */
export async function reportNavOnchain({ env, vaultAddress, reportedAssets, walletId }) {
  if (!LIVE || !vaultAddress) {
    return { txHash: "0xmock" + Math.random().toString(16).slice(2, 10), mode: "mock" };
  }
  // TODO (live): encode reportNav(reportedAssets) and send via Privy server wallet.
  throw new Error("Privy server wallet not configured — set PRIVY_APP_SECRET");
}

/**
 * Permissionlessly crank expired trade-close windows on-chain (MoltbitVault.crank).
 * Mock-safe.
 */
export async function crankOnchain({ env, vaultAddress, ids, walletId }) {
  if (!LIVE || !vaultAddress || !ids || ids.length === 0) {
    return { txHash: "0xmock" + Math.random().toString(16).slice(2, 10), mode: "mock", ids: ids || [] };
  }
  // TODO (live): encode crank(ids) and send via Privy server wallet.
  throw new Error("Privy server wallet not configured — set PRIVY_APP_SECRET");
}
