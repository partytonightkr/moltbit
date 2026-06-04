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

// Send USDC from the Privy embedded wallet. Returns the tx hash.
// `wallet` is a Privy wallet object (from useWallets()).
export async function sendUsdc(env, wallet, to, amountUsdc) {
  if (!wallet) throw new Error('No wallet connected');
  if (!isAddr(to)) throw new Error('Invalid destination address');
  const c = CHAINS[env];
  // make sure the embedded wallet is on the right chain
  try { await wallet.switchChain(c.chain.id); } catch { /* some providers no-op */ }
  const provider = await wallet.getEthereumProvider();
  const walletClient = createWalletClient({
    account: getAddress(wallet.address),
    chain: c.chain,
    transport: custom(provider),
  });
  return walletClient.writeContract({
    address: c.usdc,
    abi: ERC20,
    functionName: 'transfer',
    args: [getAddress(to), parseUnits(String(amountUsdc), 6)],
  });
}

// Where human deposits are sent. Real product = per-vault contract addresses;
// for now a single configurable treasury (per-strategy override supported via s.depositAddress).
export function depositAddressFor(strategy) {
  return (strategy && strategy.depositAddress) || import.meta.env.VITE_DEPOSIT_ADDRESS || null;
}
