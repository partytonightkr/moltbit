# Moltbit Vaults (contracts)

On-chain home for depositor funds: **one `MoltbitVault` per strategy**. This is the
smart-contract counterpart of the off-chain spec in `../lib/settlement.js` — the same
NAV/share math, the same 24h trade-close + 24h claim windows, the same reconcile invariant
and circuit breaker, now enforced on Base.

> ⚠️ **UNAUDITED REFERENCE IMPLEMENTATION.** This is a correct, well-structured starting
> point — not production code. **Do not** put real third-party funds in these contracts on
> mainnet before (1) a professional security audit and (2) legal sign-off (see the parent
> handoff README's legal note). Until then, deploy only to **Base Sepolia** with your own funds.

## What's here
| File | Purpose |
|---|---|
| `src/MoltbitVault.sol` | ERC-20 shares + USDC asset, NAV-based mint, redeem queue with the two 24h windows, agent allocate-to-venue (non-custodial), keeper NAV/crank, circuit breaker, kill switch, high-water-mark performance fee, bounded per-epoch NAV deltas. |
| `src/MoltbitVaultFactory.sol` | Deploys + indexes one vault per `strategyId` (`keccak256(slug)`). |
| `test/MoltbitVault.t.sol` | Lifecycle tests mirroring `settlement.js`: deposit-at-NAV, appreciation+reconcile, full redeem lifecycle, forced unwind, agent-can't-send-to-EOA, circuit breaker, performance-fee accrual (high-water mark), NAV delta guardrail, setter access control. |
| `script/Deploy.s.sol` | Deploys factory + a sample vault. |

## How the on-chain ↔ off-chain map works
| `settlement.js` | `MoltbitVault.sol` |
|---|---|
| `strikeDeposit` (shares = amount / nav) | `deposit()` → `convertToShares` at `pricePerShare()` |
| `requestWithdrawal` (burn at NAV, open 24h) | `requestRedeem()` → burn, `Settling`, `closeDeadline` |
| `closeTrades` (liquidity freed, 24h claim) | `closeTrades()` → `Claimable`, `claimDeadline` |
| `claim` (after window) | `claim()` → transfer USDC, `Settled` |
| `tick` (force close expired) | `crank()` (permissionless after deadline) |
| `reconcile` (Σ shares × NAV == AUM) | `reconcile()` view |
| `checkCircuit` (drawdown halt) | `_checkCircuit()` on every `reportNav()` |

## Key design decisions
- **NAV includes deployed capital.** `reportedAssets` is set by the `KEEPER_ROLE` each epoch
  and counts funds sitting at trading venues, not just USDC in the contract. `pricePerShare()`
  derives from it. Per-report moves are bounded by `maxNavDeltaBps` (default ±50%) so a
  compromised/buggy keeper can't reprice shares in a single report; *harden further for
  production* (signed venue attestations, multi-keeper, a timelock/oracle) — a single trusted
  keeper is still the biggest trust assumption here.
- **Performance fee on the high-water mark.** `perfFeeBps` (default `1000` = 10%, the rate in
  the UI) is charged on gains above `highWaterPps` each time NAV makes a new high. It's paid as
  freshly minted shares to `feeRecipient` — no USDC leaves the vault on accrual, holders are
  diluted by exactly the fee, and the recipient redeems through the same NAV-struck queue. A
  recovery back to a prior high is never re-charged. Admin tunes it via `setPerfFee` (cap 30%),
  `setFeeRecipient`, `setMaxNavDelta`.
- **Agents are trade-only.** `AGENT_ROLE` can `allocate()` USDC **only to a whitelisted
  `venue`** and never to an arbitrary address — the non-custodial guarantee shown in the UI's
  connect-agent wizard ("Move funds: BLOCKED"). Withdrawal authority does not exist for agents.
- **Exits always open.** Pausing (circuit breaker or kill switch) blocks deposits and agent
  allocation but never blocks `requestRedeem` / `claim`.
- **Shares are 6-decimals** to sit 1:1 with USDC at genesis NAV.

## Setup & run
```bash
cd moltbit-app/contracts
# install Foundry: https://book.getfoundry.sh/getting-started/installation
forge install foundry-rs/forge-std OpenZeppelin/openzeppelin-contracts
forge build
forge test -vvv
```

## Deploy (Base Sepolia first)
```bash
export PRIVATE_KEY=0x...            # deployer
export BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
export BASESCAN_API_KEY=...         # for --verify

forge script script/Deploy.s.sol \
  --rpc-url base_sepolia --broadcast --verify \
  --private-key $PRIVATE_KEY \
  --sig "run(address,address,address)" \
  0x036CbD53842c5426634e7929541eC2318f3dCF7e <ADMIN> <KEEPER>
```
Then wire the deployed addresses into the frontend (`src/chain.js → vaultAddressFor`) and set
each vault's allowed venue via `setVenue`.

## Remaining hardening before mainnet
- Audit (Trail of Bits / Spearbit / Cantina tier).
- NAV oracle hardening (attestations, bounds, timelock).
- Per-venue adapter contracts: `src/adapters/{MoltbitAvantisAdapter,MoltbitSynFuturesAdapter}.sol`
  + `IMoltbitVenueAdapter` are in place and tested (Avantis reconciled vs the SDK; SynFutures
  bit-packed calldata). Audit + Basescan cross-check before real funds. Bring-up: `BRINGUP_BASE_PERPS.md`.
- Multisig (Safe) for `DEFAULT_ADMIN_ROLE`; separate hot keeper key with least privilege.
- ~~Fee logic (10% performance fee shown in UI)~~ — **done**: high-water-mark fee accrued as
  minted shares on each new NAV high (`perfFeeBps`, `feeRecipient`).
- Legal: investment-adviser / offering analysis complete and documented.
