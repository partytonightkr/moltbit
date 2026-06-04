# Bring-up: live perp trading on Base (Avantis / SynFutures)

Goal: take an agent from the mock pipeline to **actually opening/closing a perp on Base**,
non-custodially, with your own USDC. Do the whole thing on a **dry run first** (small size,
or Base Sepolia if the venue has a testnet), then repeat on mainnet. The vault + adapter are
**UNAUDITED** — your own funds only, small size, audit before third-party capital.

## Architecture (no HTTP venue in the loop — execution is on-chain)
```
MoltbitVault (USDC, Base)
  ── agent: allocate(adapter, margin) ──►  MoltbitAvantisAdapter  ──► Avantis Trading
  keeper/server wallet: adapter.openTrade(...) / closeTrade(...)        (gTrade-style)
  keeper: adapter.returnIdleToVault() ──► vault.returnFromVenue(freedUSDC)
  keeper: vault.reportNav(markToMarket)  (position PnL recognized here)
```
The adapter is the position owner (`trader = address(this)`), so the vault only ever sends
USDC to a whitelisted **contract** — the non-custodial guarantee holds.

## 0. Avantis addresses + verification (Base mainnet)
The adapter's `IAvantisTrading` is reconciled against the official Avantis integration SDK
(`Avantis-Labs/avantisfi-integration`): `openTrade(Trade, uint8 orderType, uint256 slippageP)`
is **payable** (execution fee = msg.value, wei); the `Trade` tuple is **11 fields** ending at
`timestamp`; collateral is approved to **TradingStorage** (not Trading).

Verified addresses:
- **Trading:** `0x44914408af82bc9983bbb330e3578e1105e11d4e`
- **TradingStorage:** `0x8a311D7048c35985aa31C131B9A13e03a5f7422d` (USDC approval target)
- **USDC:** `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` (6dp)
- **orderType enum:** MARKET=0, STOP_LIMIT=1, LIMIT=2, MARKET_PNL=3
- `pairIndex`: the asset index for your market (e.g. ETH/USD) — read from the Avantis SDK/docs.

Residual check before real size:
- [ ] Cross-check the enum names + the internal `transferFrom` (Trading→TradingStorage) against
      the **Basescan-verified source** (the SDK ABI is authoritative for encoding, not the
      deployed source). Use a Basescan/Etherscan API key from your own infra to pull the ABI.

> **SynFutures path (`MoltbitSynFuturesAdapter`, built):** routes through the **Gate**
> (`0x208B443983D8BcC8578e9D86Db23FbA547071270`) + a per-market **Instrument**. Calldata is
> bit-packed `bytes32` (verified against `SynFutures/oyster-sdk`): Gate `deposit`/`withdraw`
> take `token | quantity<<160` (USDC 6dp); Instrument `trade([page0,page1])` packs
> `expiry|limitTick<<32|deadline<<56` and `amount | size<<128` (margin/size 18dp, direction =
> sign of size, `PERP_EXPIRY = 2^32-1`). Flow: approve Gate → `depositMargin` → `trade` →
> `withdrawMargin` → `returnIdleToVault`. **The keeper computes `limitTick`/`size`/`amount`
> off-chain with the SynFutures SDK** (oracle/tick math can't run on-chain), and the per-market
> **Instrument address** must come from the docs/Observer. Start with Avantis (one market call);
> SynFutures when you want the Oyster AMM book.

## 1. Compile + test the contracts
```bash
cd contracts
forge install foundry-rs/forge-std OpenZeppelin/openzeppelin-contracts   # if not vendored
forge build
forge test -vvv     # includes MoltbitAvantisAdapter.t.sol (allocate→open→close→return)
```

## 2. Deploy (dry run: small size first)
```bash
export PRIVATE_KEY=0x...                 # your funded deployer (admin)
export BASE_RPC_URL=https://mainnet.base.org
export BASESCAN_API_KEY=...

# vault (admin = you/multisig, keeper = your server-wallet/keeper key, agent = strategy key)
forge create src/MoltbitVault.sol:MoltbitVault \
  --rpc-url $BASE_RPC_URL --private-key $PRIVATE_KEY --verify \
  --constructor-args "Moltbit Avantis ETH" "mAVTE" <USDC> 2000 <ADMIN> <KEEPER> <AGENT>

# adapter (vault, USDC, Avantis Trading, Avantis TradingStorage, admin, keeper)
forge create src/adapters/MoltbitAvantisAdapter.sol:MoltbitAvantisAdapter \
  --rpc-url $BASE_RPC_URL --private-key $PRIVATE_KEY --verify \
  --constructor-args <VAULT> 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 \
    0x44914408af82bc9983bbb330e3578e1105e11d4e 0x8a311D7048c35985aa31C131B9A13e03a5f7422d \
    <ADMIN> <KEEPER>
```

## 3. Wire it up
- [ ] `vault.setVenue(adapter, true)` (admin) — whitelist the adapter as the venue.
- [ ] App env: `VITE_VAULTS={"<strategyId>":"<vault>"}`, and set the strategy's
      `venue` = adapter address, `serverWalletId` = your Privy server wallet (or keeper).
- [ ] Server wallet / keeper key must hold **KEEPER_ROLE** on the adapter and the vault.

## 4. Fund + smoke-test the loop (tiny size)
1. Deposit a small amount of USDC: `vault.deposit(amount, you)` → you receive shares.
2. `vault.allocate(adapter, margin)` (agent key) → margin lands in the adapter.
3. `adapter.openTrade(pairIndex, buy, margin, 0 /*market*/, leverage, 0, 0, orderType,
   slippageP, executionFee)` (keeper). Confirm the position on Avantis.
4. `adapter.closeTrade(pairIndex, index, collateralToClose, executionFee)` (keeper).
5. `adapter.returnIdleToVault()` (keeper) → USDC back in the vault.
6. `vault.reportNav(markToMarket)` (keeper) → NAV/PnL recognized; `reconcile()` balanced.
7. `vault.requestRedeem(shares)` → 24h trade-close → 24h claim → `claim()`. Full circle.

## 5. Readiness gate before you scale size
- [ ] Adapter ABI verified against the deployed Avantis contract (step 0).
- [ ] One full loop completed with real (tiny) USDC and reconciled.
- [ ] `DEFAULT_ADMIN_ROLE` on a multisig; keeper is a separate least-privilege key.
- [ ] Adapter + vault audited before any third-party capital (see `../LAUNCH_READINESS.md`).
- [ ] Execution-fee (keeper-bot) funding handled; `sweepNative` recovers refunds.
