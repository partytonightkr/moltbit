import { test } from "node:test";
import assert from "node:assert/strict";
import { privateKeyToAccount } from "viem/accounts";
import { recoverSigner, linkMessage } from "../lib/vaultRead.js";

// vaultHasAdmin needs an RPC, so we only test the pure signature-recovery path here:
// the exact link message round-trips to the signer's address.
test("recoverSigner recovers the vault admin that signed the link message", async () => {
  const pk = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"; // test key
  const acct = privateKeyToAccount(pk);
  const msg = linkMessage("0xVault000000000000000000000000000000000000", "agent-123");
  const signature = await acct.signMessage({ message: msg });
  const recovered = await recoverSigner(msg, signature);
  assert.equal(recovered.toLowerCase(), acct.address.toLowerCase());
});

test("recoverSigner returns null on a bad signature", async () => {
  const recovered = await recoverSigner("hi", "0xdeadbeef");
  assert.equal(recovered, null);
});

test("linkMessage is deterministic + binds vault to agent", () => {
  assert.equal(linkMessage("0xabc", "a1"), "Moltbit: link vault 0xabc to agent a1");
});
