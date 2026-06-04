// On-chain layer — real USDC balance reads + transfers via the Privy embedded wallet.
// Test  = Base Sepolia (testnet USDC)   ·   Live = Base mainnet (USDC)
import {
  createPublicClient, createWalletClient, http, custom,
  parseUnits, formatUnits, getAddress, isAddress,
} from 'viem';
import { base, baseSepolia } from 'viem/chains';

// USDC contracts (real addresses).
export const CHAINS = {
  live: {
    chain: base,
    usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    label: 'Base',
    explorer: 'https://basescan.org/tx/',
    rpc: import.meta.env.VITE_RPC_URL_BASE || undefined,
  },
  test: {
    chain: baseSepolia,
    usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    label: 'Base Sepolia',
    explorer: 'https://sepolia.basescan.org/tx/',
    rpc: import.meta.env.VITE_RPC_URL_BASE_SEPOLIA || undefined,
  },
};

const ERC20 = [
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'a', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'transfer', stateMutability: 'nonpayable', inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'allowance', stateMutability: 'view', inputs: [{ name: 'o', type: 'address' }, { name: 's', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'approve', stateMutability: 'nonpayable', inputs: [{ name: 's', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] },
];

// Minimal MoltbitVault ABI (see contracts/src/MoltbitVault.sol).
const VAULT = [
  { type: 'function', name: 'deposit', stateMutability: 'nonpayable', inputs: [{ name: 'assets', type: 'uint256' }, { name: 'receiver', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'requestRedeem', stateMutability: 'nonpayable', inputs: [{ name: 'shares', type: 'uint256' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'a', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'pricePerShare', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'convertToAssets', stateMutability: 'view', inputs: [{ name: 'shares', type: 'uint256' }], outputs: [{ type: 'uint256' }] },
];

export const isAddr = (a) => !!a && isAddress(a);
export const explorerTx = (env, hash) => (CHAINS[env]?.explorer || '') + hash;

function publicClientFor(env) {
  const c = CHAINS[env];
  return createPublicClient({ chain: c.chain, transport: http(c.rpc) });
}

// Read on-chain USDC balance (returns a Number of USDC).
export async function getUsdcBalance(env, address) {
  if (!isAddr(address)) return null;
  const c = CHAINS[env];
  const pc = publicClientFor(env);
  const raw = await pc.readContract({ address: c.usdc, abi: ERC20, functionName: 'balanceOf', args: [getAddress(address)] });
  return Number(formatUnits(raw, 6));
}

// Send USDC. If a sponsored smart-wallet `client` is provided, the tx is
// gas-sponsored (no ETH needed); otherwise it's signed by the embedded wallet.
// Returns the tx hash.
export async function sendUsdc(env, wallet, to, amountUsdc, smartClient) {
  if (!isAddr(to)) throw new Error('Invalid destination address');
  const c = CHAINS[env];
  const data = { address: c.usdc, abi: ERC20, functionName: 'transfer', args: [getAddress(to), parseUnits(String(amountUsdc), 6)] };
  if (smartClient) return smartClient.writeContract({ chain: c.chain, ...data });
  if (!wallet) throw new Error('No wallet connected');
  const walletClient = await embeddedClient(env, wallet);
  return walletClient.writeContract(data);
}

// build a viem wallet client from a Privy embedded wallet
async function embeddedClient(env, wallet) {
  const c = CHAINS[env];
  try { await wallet.switchChain(c.chain.id); } catch { /* some providers no-op */ }
  const provider = await wallet.getEthereumProvider();
  return createWalletClient({ account: getAddress(wallet.address), chain: c.chain, transport: custom(provider) });
}

// Where human deposits are sent. Real product = per-vault contract addresses;
// for now a single configurable treasury (per-strategy override supported via s.depositAddress).
export function depositAddressFor(strategy) {
  return (strategy && strategy.depositAddress) || import.meta.env.VITE_DEPOSIT_ADDRESS || null;
}

// Per-strategy vault address (MoltbitVault). Prefer this over depositAddressFor once
// vaults are deployed: a deposit mints shares at NAV instead of a plain transfer.
// Resolution order: explicit strategy.vaultAddress → env map (JSON) → null.
export function vaultAddressFor(strategy) {
  if (strategy && strategy.vaultAddress) return strategy.vaultAddress;
  try {
    const map = JSON.parse(import.meta.env.VITE_VAULTS || '{}');
    return (strategy && map[strategy.id]) || map._default || null;
  } catch {
    return null;
  }
}

// Deposit USDC into a strategy vault: approve (if needed) then vault.deposit().
// Returns the deposit tx hash. Mints shares to the user at the current NAV.
// If `smartClient` is provided, both txs are gas-sponsored.
export async function depositToVault(env, wallet, vaultAddress, amountUsdc, smartClient) {
  if (!isAddr(vaultAddress)) throw new Error('No vault configured');
  const c = CHAINS[env];
  const pc = publicClientFor(env);
  const amount = parseUnits(String(amountUsdc), 6);
  const writer = smartClient || (wallet ? await embeddedClient(env, wallet) : null);
  if (!writer) throw new Error('No wallet connected');
  const account = smartClient ? undefined : getAddress(wallet.address);
  const owner = smartClient ? (await smartClient.account?.address ?? account) : account;

  // approve only if allowance is insufficient
  const allowance = await pc.readContract({
    address: c.usdc, abi: ERC20, functionName: 'allowance', args: [owner, getAddress(vaultAddress)],
  });
  if (allowance < amount) {
    const approveHash = await writer.writeContract({
      chain: c.chain, address: c.usdc, abi: ERC20, functionName: 'approve', args: [getAddress(vaultAddress), amount],
    });
    await pc.waitForTransactionReceipt({ hash: approveHash });
  }
  return writer.writeContract({
    chain: c.chain, address: getAddress(vaultAddress), abi: VAULT, functionName: 'deposit', args: [amount, owner],
  });
}

// Request redemption of vault shares (burns at NAV, opens the 24h trade-close window).
export async function requestVaultRedeem(env, wallet, vaultAddress, shares, smartClient) {
  if (!isAddr(vaultAddress)) throw new Error('No vault configured');
  const c = CHAINS[env];
  const writer = smartClient || (wallet ? await embeddedClient(env, wallet) : null);
  if (!writer) throw new Error('No wallet connected');
  return writer.writeContract({
    chain: c.chain, address: getAddress(vaultAddress), abi: VAULT, functionName: 'requestRedeem', args: [parseUnits(String(shares), 6)],
  });
}
