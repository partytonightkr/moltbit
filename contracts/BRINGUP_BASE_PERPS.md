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

## 0. Pin the venue ABI/addresses (do this FIRST)
`IAvantisTrading` in `MoltbitAvantisAdapter.sol` matches the Avantis SDK field set, but the
**on-chain struct layout and selectors are authoritative**. Before deploying:
- [ ] Open the Avantis **Trading** contract on https://basescan.org → copy the verified ABI.
- [ ] Reconcile `openTrade` / `closeTradeMarket` signatures + the `Trade` struct field order
      and decimals (positionSizeUSDC 6dp; openPrice/leverage/tp/sl 10dp) against the adapter.
      Fix the interface if they differ, then re-run the adapter tests.
- [ ] Note the Trading contract address, the USDC address (`0x8335…2913` on Base mainnet),
      and the `pairIndex` for the market you want (e.g. ETH/USD).
- [ ] Confirm whether Avantis pulls collateral via `transferFrom` on `openTrade` (the adapter
      `forceApprove`s the margin) or via a separate storage contract — adjust the approve target.

> SynFutures path: same adapter pattern, but it routes through the **Gate** contract
> (`0x208B443983D8BcC8578e9D86Db23FbA547071270` on Base) + instrument/vault contracts and an
> order-book fill. Build `MoltbitSynFuturesAdapter` implementing `IMoltbitVenueAdapter` once
> Avantis is proven; Avantis (single market call) is the simpler first integration.

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

# adapter (vault, USDC, Avantis Trading, admin, keeper)
forge create src/adapters/MoltbitAvantisAdapter.sol:MoltbitAvantisAdapter \
  --rpc-url $BASE_RPC_URL --private-key $PRIVATE_KEY --verify \
  --constructor-args <VAULT> <USDC> <AVANTIS_TRADING> <ADMIN> <KEEPER>
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
