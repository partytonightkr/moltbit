import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeFunctionData } from "viem";
import {
  VAULT_ABI, ADAPTER_ABI, CAIP2,
  encodeAllocate, encodeReturnFromVenue, encodeReportNav, encodeCrank, encodeSetPaused,
  encodeAdapterOpen, encodeAdapterClose, encodeAdapterReturnIdle,
} from "../lib/chainServer.js";

const VENUE = "0x000000000000000000000000000000000000dEaD";

function decode(data) {
  return decodeFunctionData({ abi: VAULT_ABI, data });
}
function decodeAdapter(data) {
  return decodeFunctionData({ abi: ADAPTER_ABI, data });
}

test("encodeAllocate encodes venue + USDC(6dp) amount", () => {
  const { functionName, args } = decode(encodeAllocate(VENUE, 1000));
  assert.equal(functionName, "allocate");
  assert.equal(args[0].toLowerCase(), VENUE.toLowerCase());
  assert.equal(args[1], 1_000_000_000n); // 1000 * 1e6
});

test("encodeReportNav encodes USDC(6dp) reported assets", () => {
  const { functionName, args } = decode(encodeReportNav(12_000));
  assert.equal(functionName, "reportNav");
  assert.equal(args[0], 12_000_000_000n);
});

test("encodeReturnFromVenue encodes USDC(6dp) amount", () => {
  const { functionName, args } = decode(encodeReturnFromVenue(250.5));
  assert.equal(functionName, "returnFromVenue");
  assert.equal(args[0], 250_500_000n);
});

test("encodeCrank encodes a uint256[] of ids", () => {
  const { functionName, args } = decode(encodeCrank([1, 2, 5]));
  assert.equal(functionName, "crank");
  assert.deepEqual(args[0], [1n, 2n, 5n]);
});

test("encodeSetPaused encodes the bool", () => {
  assert.equal(decode(encodeSetPaused(true)).args[0], true);
  assert.equal(decode(encodeSetPaused(false)).args[0], false);
});

test("CAIP2 maps envs to Base chain ids", () => {
  assert.equal(CAIP2.live, "eip155:8453");
  assert.equal(CAIP2.test, "eip155:84532");
});

test("encodeAdapterOpen scales margin (6dp) and 10dp fields", () => {
  const { functionName, args } = decodeAdapter(
    encodeAdapterOpen({ pairIndex: 1, buy: true, marginUsdc: 5000, openPrice: 0, leverage: 3, slippagePct: 1, orderType: 0 })
  );
  assert.equal(functionName, "openTrade");
  assert.equal(args[0], 1n);              // pairIndex
  assert.equal(args[1], true);            // buy
  assert.equal(args[2], 5_000_000_000n);  // marginUsdc 5000 * 1e6
  assert.equal(args[3], 0n);              // openPrice (market)
  assert.equal(args[4], 30_000_000_000n); // leverage 3 * 1e10
  assert.equal(args[7], 0);               // orderType (uint8)
  assert.equal(args[8], 10_000_000_000n); // slippage 1 * 1e10
});

test("encodeAdapterClose scales collateral (6dp)", () => {
  const { functionName, args } = decodeAdapter(
    encodeAdapterClose({ pairIndex: 1, index: 2, collateralToCloseUsdc: 5000, executionFee: 0 })
  );
  assert.equal(functionName, "closeTrade");
  assert.equal(args[0], 1n);
  assert.equal(args[1], 2n);
  assert.equal(args[2], 5_000_000_000n);
});

test("encodeAdapterReturnIdle encodes the no-arg sweep", () => {
  assert.equal(decodeAdapter(encodeAdapterReturnIdle()).functionName, "returnIdleToVault");
});
