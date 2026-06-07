// Read live on-chain vault state (NAV, AUM, shares) so the UI reflects real
// deposits/PnL instead of stored numbers. Server-side viem read over a public RPC.
// Pure formatter is exported for tests; the RPC call runs at request time on Vercel.
import { createPublicClient, http, getAddress, isAddress, recoverMessageAddress } from "viem";
import { base, baseSepolia } from "viem/chains";

const CHAIN = { live: base, test: baseSepolia };
const RPC = {
  live: process.env.RPC_URL_BASE || process.env.VITE_RPC_URL_BASE,
  test: process.env.RPC_URL_BASE_SEPOLIA || process.env.VITE_RPC_URL_BASE_SEPOLIA,
};

const VAULT_ABI = [
  { type: "function", name: "pricePerShare", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "reportedAssets", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "totalSupply", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "pendingLiability", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "paused", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
];

// raw bigints (6dp USDC / 1e6 pps) → human numbers. Pure + testable.
export function formatVaultState({ pps, reportedAssets, totalSupply, pendingLiability, paused }) {
  const nav = Number(pps) / 1e6; // price per share
  const aumUsd = Number(reportedAssets) / 1e6; // USD
  const shares = Number(totalSupply) / 1e6;
  const liabilityUsd = Number(pendingLiability) / 1e6;
  return {
    nav,
    aumUsd,
    aumM: aumUsd / 1e6, // $M, to match the agent record's `aum`
    shares,
    liabilityUsd,
    paused: !!paused,
  };
}

export function vaultConfigured(env) {
  return !!(RPC[env] || CHAIN[env]); // baseSepolia has a public default RPC
}

const ACL_ABI = [
  { type: "function", name: "hasRole", stateMutability: "view", inputs: [{ type: "bytes32" }, { type: "address" }], outputs: [{ type: "bool" }] },
];
const DEFAULT_ADMIN_ROLE = "0x0000000000000000000000000000000000000000000000000000000000000000";

// The exact message a vault admin signs to prove ownership when linking.
export function linkMessage(vaultAddress, agentId) {
  return `Moltbit: link vault ${vaultAddress} to agent ${agentId}`;
}

// Recover the signer of a personal_sign message (pure crypto; no RPC). null on failure.
export async function recoverSigner(message, signature) {
  try { return await recoverMessageAddress({ message, signature }); }
  catch { return null; }
}

// Does `account` hold DEFAULT_ADMIN_ROLE on the vault? (AccessControl read.)
export async function vaultHasAdmin(env, address, account) {
  if (!isAddress(address) || !isAddress(account)) return false;
  const chain = CHAIN[env] || baseSepolia;
  const client = createPublicClient({ chain, transport: http(RPC[env] || undefined) });
  try {
    return await client.readContract({ address: getAddress(address), abi: ACL_ABI, functionName: "hasRole", args: [DEFAULT_ADMIN_ROLE, getAddress(account)] });
  } catch { return false; }
}

// Read the vault. Returns null on bad input; throws on RPC failure (caller catches).
export async function readVault({ env = "test", address }) {
  if (!address || !isAddress(address)) return null;
  const chain = CHAIN[env] || baseSepolia;
  const client = createPublicClient({ chain, transport: http(RPC[env] || undefined) });
  const a = getAddress(address);
  const [pps, reportedAssets, totalSupply, pendingLiability, paused] = await Promise.all([
    client.readContract({ address: a, abi: VAULT_ABI, functionName: "pricePerShare" }),
    client.readContract({ address: a, abi: VAULT_ABI, functionName: "reportedAssets" }),
    client.readContract({ address: a, abi: VAULT_ABI, functionName: "totalSupply" }),
    client.readContract({ address: a, abi: VAULT_ABI, functionName: "pendingLiability" }),
    client.readContract({ address: a, abi: VAULT_ABI, functionName: "paused" }),
  ]);
  return formatVaultState({ pps, reportedAssets, totalSupply, pendingLiability, paused });
}
