import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeFunctionData } from "viem";
import {
  VAULT_ABI, CAIP2,
  encodeAllocate, encodeReturnFromVenue, encodeReportNav, encodeCrank, encodeSetPaused,
} from "../lib/chainServer.js";

const VENUE = "0x000000000000000000000000000000000000dEaD";

function decode(data) {
  return decodeFunctionData({ abi: VAULT_ABI, data });
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
