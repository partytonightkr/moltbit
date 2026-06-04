// Server-side chain helper — encodes MoltbitVault calldata (viem) and submits it
// through a Privy SERVER wallet over Privy's REST API. No browser, no private key
// in this process: the server wallet is scoped (in the Privy dashboard) to only the
// vault methods below. Pure encoders are exported so they can be unit-tested without
// any network or credentials.
import { encodeFunctionData, parseUnits, getAddress } from "viem";

const APP_ID = process.env.PRIVY_APP_ID || process.env.VITE_PRIVY_APP_ID;
const APP_SECRET = process.env.PRIVY_APP_SECRET;
const PRIVY_API = process.env.PRIVY_API_URL || "https://api.privy.io/v1";

// CAIP-2 chain ids: Base mainnet (live) / Base Sepolia (test).
export const CAIP2 = { live: "eip155:8453", test: "eip155:84532" };

// Server-relevant slice of the MoltbitVault ABI.
export const VAULT_ABI = [
  { type: "function", name: "allocate", stateMutability: "nonpayable", inputs: [{ name: "venue", type: "address" }, { name: "assets", type: "uint256" }], outputs: [] },
  { type: "function", name: "returnFromVenue", stateMutability: "nonpayable", inputs: [{ name: "assets", type: "uint256" }], outputs: [] },
  { type: "function", name: "reportNav", stateMutability: "nonpayable", inputs: [{ name: "newReportedAssets", type: "uint256" }], outputs: [] },
  { type: "function", name: "crank", stateMutability: "nonpayable", inputs: [{ name: "ids", type: "uint256[]" }], outputs: [] },
  { type: "function", name: "setPaused", stateMutability: "nonpayable", inputs: [{ name: "p", type: "bool" }], outputs: [] },
];

// USDC carries 6 decimals; reportNav/allocate take USDC base units.
const usdc6 = (amountUsdc) => parseUnits(String(amountUsdc ?? 0), 6);

// ---- pure calldata encoders (unit-testable) -----------------------------------
export function encodeAllocate(venue, amountUsdc) {
  return encodeFunctionData({ abi: VAULT_ABI, functionName: "allocate", args: [getAddress(venue), usdc6(amountUsdc)] });
}
export function encodeReturnFromVenue(amountUsdc) {
  return encodeFunctionData({ abi: VAULT_ABI, functionName: "returnFromVenue", args: [usdc6(amountUsdc)] });
}
export function encodeReportNav(reportedAssetsUsdc) {
  return encodeFunctionData({ abi: VAULT_ABI, functionName: "reportNav", args: [usdc6(reportedAssetsUsdc)] });
}
export function encodeCrank(ids) {
  return encodeFunctionData({ abi: VAULT_ABI, functionName: "crank", args: [(ids || []).map((x) => BigInt(x))] });
}
export function encodeSetPaused(paused) {
  return encodeFunctionData({ abi: VAULT_ABI, functionName: "setPaused", args: [!!paused] });
}

// Server-relevant slice of MoltbitAvantisAdapter (the on-chain venue). Decimals:
// margin USDC 6dp; openPrice/leverage/tp/sl/slippage 10dp (matches the Avantis SDK).
// The adapter's openTrade/closeTrade are payable: the Avantis keeper-bot execution fee
// is forwarded as msg.value (wei), so it is the tx `value`, NOT a calldata arg.
export const ADAPTER_ABI = [
  { type: "function", name: "openTrade", stateMutability: "payable", inputs: [
    { name: "pairIndex", type: "uint256" }, { name: "buy", type: "bool" }, { name: "marginUsdc", type: "uint256" },
    { name: "openPrice", type: "uint256" }, { name: "leverage", type: "uint256" }, { name: "tp", type: "uint256" },
    { name: "sl", type: "uint256" }, { name: "orderType", type: "uint8" }, { name: "slippageP", type: "uint256" },
  ], outputs: [] },
  { type: "function", name: "closeTrade", stateMutability: "payable", inputs: [
    { name: "pairIndex", type: "uint256" }, { name: "index", type: "uint256" }, { name: "collateralToClose", type: "uint256" },
  ], outputs: [] },
  { type: "function", name: "returnIdleToVault", stateMutability: "nonpayable", inputs: [], outputs: [{ type: "uint256" }] },
];

const e10 = (v) => parseUnits(String(v ?? 0), 10); // 10-decimal fixed point

// open a position on the adapter. Human inputs in, on-chain scaling out. (executionFee
// is handled as the tx value by the server wallet, not encoded here.)
export function encodeAdapterOpen({ pairIndex, buy, marginUsdc, openPrice = 0, leverage = 1, tp = 0, sl = 0, orderType = 0, slippagePct = 1 }) {
  return encodeFunctionData({ abi: ADAPTER_ABI, functionName: "openTrade", args: [
    BigInt(pairIndex), !!buy, usdc6(marginUsdc), e10(openPrice), e10(leverage), e10(tp), e10(sl),
    Number(orderType), e10(slippagePct),
  ] });
}
export function encodeAdapterClose({ pairIndex, index, collateralToCloseUsdc }) {
  return encodeFunctionData({ abi: ADAPTER_ABI, functionName: "closeTrade", args: [
    BigInt(pairIndex), BigInt(index), usdc6(collateralToCloseUsdc),
  ] });
}
export function encodeAdapterReturnIdle() {
  return encodeFunctionData({ abi: ADAPTER_ABI, functionName: "returnIdleToVault", args: [] });
}

export const PRIVY_CONFIGURED = !!(APP_ID && APP_SECRET);

// ---- transaction submission via the Privy server wallet -----------------------
// Sends a single tx { to, data } on the env's chain. Returns the tx hash.
export async function sendVaultTx({ env, walletId, to, data, value = "0x0" }) {
  if (!PRIVY_CONFIGURED) throw new Error("Privy server wallet not configured — set PRIVY_APP_ID + PRIVY_APP_SECRET");
  if (!walletId) throw new Error("missing server walletId for this vault");
  const caip2 = CAIP2[env] || CAIP2.test;
  const auth = Buffer.from(`${APP_ID}:${APP_SECRET}`).toString("base64");

  const r = await fetch(`${PRIVY_API}/wallets/${walletId}/rpc`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Basic ${auth}`,
      "privy-app-id": APP_ID,
    },
    body: JSON.stringify({
      method: "eth_sendTransaction",
      caip2,
      params: { transaction: { to: getAddress(to), data, value } },
    }),
  });

  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Privy ${r.status}: ${JSON.stringify(body).slice(0, 300)}`);
  // Privy returns the hash under data.hash (REST) — tolerate a couple of shapes.
  const hash = body?.data?.hash || body?.hash || body?.transactionHash;
  if (!hash) throw new Error(`Privy response missing tx hash: ${JSON.stringify(body).slice(0, 300)}`);
  return hash;
}
