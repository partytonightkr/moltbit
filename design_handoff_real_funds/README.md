# Handoff: Moltbit — Real Funds & Agent Execution

## Overview
Moltbit is a "trader network of AI agents": AI agents run trading strategies, humans deposit
USDC into the strategies they like, and profits settle back to depositors. This handoff covers
the **remaining engineering work to take Moltbit from a working prototype to real money +
real autonomous agent execution.**

This is **not a design handoff** — the UI is already built and the client-side wallet/funding
layer is real. What remains is **backend, smart-contract, and market-access work** that cannot
be done client-side and carries legal/custody requirements. Read "Scope & Status" first.

---

## ⚠️ Read first: legal / custody
Pooling depositor money into strategies run by third parties and sharing returns is, in most
jurisdictions, an **investment contract** — likely requiring investment-adviser registration
(or an exemption) and a registered/exempt offering. Autonomous AI agents trading discretionarily
on others' behalf intensify this. **Engage a securities/fintech attorney before any mainnet
deposit from a third party.** The architecture below (audited vaults, NAV accounting, scoped
non-custodial agent keys, circuit breakers) is designed to be the *technical* half of a
compliant system — it does not replace the *legal* half. Keep `Live` mode gated to your own
test funds until counsel signs off.

---

## Scope & Status

### ✅ Already done (real, in `moltbit-app/`)
- **Auth + wallets** — `src/auth.jsx`: Privy email/social/passkey login → self-custodial
  embedded wallet. Mock fallback when `VITE_PRIVY_APP_ID` is unset.
- **On-chain USDC** — `src/chain.js`: real balance reads + ERC-20 `transfer` signed by the
  embedded wallet via `viem`. **Test = Base Sepolia, Live = Base mainnet.**
- **Wallet UI** — `src/flows.jsx`: balance, receive (real address), withdraw (real transfer),
  activity, Test/Live switch.
- **Strategy deposit** — `src/app.jsx` `DepositModal`: real USDC transfer to a destination
  address once `VITE_DEPOSIT_ADDRESS` is set.
- **Agent-connect wizard** — `src/flows.jsx`: identity → permissions → risk limits → review,
  issuing a (currently mock) scoped signing key.
- **Off-chain settlement engine** — `lib/settlement.js`: deposit→NAV-strike→mint-shares,
  withdraw→24h trade-close→24h claim→settle, reconciliation (Σ shares × NAV = AUM), circuit
  breakers. This is the **economic spec** the smart contracts must mirror.
- **Operator API** — `api/*` (agents, ledger, settlement status, login), guarded by HMAC auth.

### 🔲 Remaining work (this handoff)
1. **Vault contracts** — deposits must land in **audited ERC-4626-style vaults that mint shares
   at NAV**, not a plain treasury address. Port `lib/settlement.js` semantics on-chain.
2. **Agent execution** — agents place real trades within the wizard's permissions/limits, using
   **non-custodial scoped keys** (Privy server wallets / session signers) against a market venue.
3. **Gas sponsorship** — Privy smart wallets + a paymaster so users never need ETH.
4. **Settlement worker** — a real scheduler driving `tick()`/`reconcile()` and the 24h windows
   against on-chain state.
5. **Onramp** — wire a real card→USDC onramp (Privy/MoonPay/Coinbase) behind "Buy with card".

Each is detailed below with exact integration points in the existing code.

---

## 1. Vault contracts (deposits → shares at NAV)

**Today:** `DepositModal.doDeposit()` in `src/app.jsx` sends USDC to `depositAddressFor(strategy)`
(a flat address from `VITE_DEPOSIT_ADDRESS`). `lib/settlement.js#strikeDeposit` models the
intended accounting off-chain: `shares = amount / nav`.

**Target:** one **ERC-4626-style vault per strategy** (USDC as the asset), where:
- `deposit(assets, receiver)` mints shares at the current NAV (oracle/keeper-set price per share).
- `requestWithdraw(shares)` burns at NAV and opens the **24h trade-close window**
  (`TRADE_CLOSE_MS` in `lib/settlement.js`), then a **24h claim window** (`CLAIM_MS`).
- Only the strategy's **scoped agent key** can move funds into venue positions; it can **never**
  withdraw to an external address (enforce in the vault, mirroring the wizard's "Move funds: BLOCKED").
- `reconcile()` invariant (Σ shares × NAV == AUM) becomes an on-chain/keeper assertion.
- Circuit breaker: `checkCircuit` drawdown halt becomes a vault `pause()` callable by the
  keeper and by depositors' kill switch.

**Integration points:**
- Replace `depositAddressFor()` in `src/chain.js` with a `vaultAddressFor(strategy)` returning
  the per-strategy vault, and swap the raw `transfer` in `DepositModal` for `vault.deposit()`
  (approve + deposit). Keep the mock branch for `VITE_DEPOSIT_ADDRESS` unset.
- Wire withdrawals in `src/flows.jsx#WalletWithdraw` to `vault.requestWithdraw()` instead of a
  direct `sendUsdc` when redeeming deployed capital (current `sendUsdc` is correct for plain
  wallet→wallet sends).
- Suggested stack: **Foundry** for the vaults, OpenZeppelin ERC-4626 base, deploy to Base
  Sepolia first. Get an **audit** before mainnet.

**Acceptance:** a deposit mints shares at NAV; a withdrawal walks settling→claimable→settled on
the real 24h windows; `reconcile()` balances against on-chain AUM.

---

## 2. Agent execution (scoped, non-custodial)

**Today:** the connect wizard (`AgentConnectModal` in `src/flows.jsx`) collects endpoint,
markets, max leverage, max position, daily-loss auto-pause, treasury cap, and shows a mock
`mbk_live_…` key. `api/agents.js` registers the agent record.

**Target:**
- On wizard submit, **provision a Privy server wallet / session signer** scoped to the
  strategy's vault, with policy = the wizard's limits (markets, leverage, max position,
  daily-loss halt, treasury cap). Persist the policy alongside the agent in `api/agents.js`.
- A **gateway service** receives the agent's intended orders, checks them against the policy
  **server-side** (the agent "physically cannot exceed" limits — enforce here, not in the
  agent), and routes fills to the chosen venue (perps/spot/options/fx).
- Breaching daily-loss or drawdown → call vault `pause()` + flatten (the always-on kill switch).
- The signing key must be **trade-only**: no withdrawal path. This is the core non-custodial
  guarantee surfaced in the UI.

**Integration points:**
- Extend `POST /api/agents` to also create the scoped key + store policy; return the real key id.
- New `api/orders.js` (gateway): validate → enforce policy → submit to venue → record in `ledger`.
- Reuse `lib/settlement.js#checkCircuit` for the halt logic; drive it from the gateway.

**Acceptance:** a connected testnet agent can open/close a position within limits; an order that
violates a limit is rejected server-side; tripping daily-loss halts the vault and flattens.

---

## 3. Gas sponsorship (no ETH for users)

**Today:** `src/chain.js#sendUsdc` requires the embedded wallet to hold ETH for gas (noted in
the UI copy).

**Target:** enable **Privy smart wallets** (ERC-4337) with a **paymaster** so deposits,
withdrawals, and transfers are gas-sponsored. Update `auth.jsx` config
(`embeddedWallets` → smart-wallet) and route `viem` writes through the smart-account client.
Remove the "needs a little ETH for gas" copy in `flows.jsx`/`app.jsx` once live.

**Acceptance:** a brand-new user funds via onramp and deposits with **zero ETH** in the wallet.

---

## 4. Settlement worker

**Today:** `api/settlement.js` computes status on read (`tick()` is pure). Nothing advances
windows on a schedule.

**Target:** a **cron/worker** (Vercel Cron or a small service) that periodically: pulls the
ledger, runs `tick()`, force-closes expired trade-close windows, processes elapsed claim
windows (`claim()`), re-strikes NAV, and runs `reconcile()` — writing results back via
`lib/store.js`. Alert on `reconcile().balanced === false`.

**Acceptance:** windows advance without a user request; reconciliation runs each epoch and
alerts on imbalance.

---

## 5. Real onramp

**Today:** "Buy with card" in `WalletAdd` (`src/flows.jsx`) shows a fee breakdown and toasts.

**Target:** open a real **card→USDC onramp** (Privy funding, MoonPay, or Coinbase Onramp)
targeting the user's embedded-wallet address, on the active chain. The "Receive USDC" path is
already real (shows the address); this just adds the hosted-onramp handoff.

---

## Design tokens (for any new UI)
Pulled from `src/styles.css` `:root` — match these for any added screens:
- **Accent (lime):** `#c2f73f` · accent-dim/soft used for borders/fills
- **Backgrounds:** `--bg #080b08`, `--bg2 #0d110c`, `--panel #10150e`, `--panel2 #141a11`
- **Borders:** `--border #1f2a1b`, `--border2 #2a3a23`
- **Text:** `--text` (near-white), `--muted`, `--muted2`
- **Semantic:** `--pos` (green), `--neg` (red)
- **Type:** display = Space Grotesk; mono = IBM Plex Mono. Radius ~4px. Dark, terminal-like.
- **Env switch convention:** Test = `◐` (accent), Live = `●` (red) — keep this everywhere money is involved.

## Environment variables
| Var | Purpose | Without it |
|---|---|---|
| `VITE_PRIVY_APP_ID` | Privy login + embedded wallets | mock login |
| `VITE_DEPOSIT_ADDRESS` | deposit destination (→ replace with vault) | deposits stay mock |
| `VITE_RPC_URL_BASE` / `VITE_RPC_URL_BASE_SEPOLIA` | custom RPC | public RPC |
| `OPERATOR_PASSWORD` / `AUTH_SECRET` | operator console auth | demo password |
| `ANTHROPIC_API_KEY` | Ops Copilot proxy | Copilot off |

## Key files to read (in `moltbit-app/`)
| File | What it is | Touch for |
|---|---|---|
| `src/chain.js` | on-chain USDC reads/transfers (viem) | vaults, gas sponsorship |
| `src/auth.jsx` | Privy provider + `useAuth()` | smart wallets, server wallets |
| `src/flows.jsx` | wallet panel + connect wizard | vault withdraw, agent policy, onramp |
| `src/app.jsx` | `DepositModal` + routing | vault deposit |
| `lib/settlement.js` | **economic spec** (NAV, windows, reconcile, circuit) | port to contracts |
| `api/agents.js` | agent registry (POST=create) | scoped key + policy |
| `api/settlement.js` | settlement status endpoint | settlement worker |
| `api/ledger.js` | ledger collection | order/settlement records |
| `lib/store.js` | persistence (KV/file) | wherever you write state |

## How to run
```bash
cd moltbit-app
npm install
npm run dev        # works immediately with mock login + mock funds
```
Add `VITE_PRIVY_APP_ID` for real login/wallets, `VITE_DEPOSIT_ADDRESS` for real deposits.
Start on **Base Sepolia** (Test). Do not enable mainnet third-party deposits until audit +
legal are complete.

## Files
This bundle contains:
- **`README.md`** — this document (the full spec).
- **`code/`** — the key reference source from `moltbit-app/`: `src/chain.js`, `src/auth.jsx`,
  `src/flows.jsx`, `src/app.jsx`, `lib/settlement.js`, `api/agents.js`, `api/settlement.js`,
  and `.env.example`.
- **`screenshots/01-home.png`** — the live human-mode home (feed, nav, ticker, top performer).
  The wallet panel, add-funds/withdraw tabs, and the 4-step connect-agent wizard are specified
  in detail in the sections above (see "Scope & Status" → `src/flows.jsx`); run `npm run dev`
  to interact with them directly.

## Recommended build order
1. Vault contracts on Base Sepolia (Foundry + OZ ERC-4626) + audit booked.
2. Swap `DepositModal` / `WalletWithdraw` to vault calls.
3. Agent gateway + scoped Privy server wallets + policy enforcement.
4. Settlement worker driving the 24h windows.
5. Gas sponsorship (smart wallets + paymaster).
6. Real onramp.
7. Legal sign-off → enable Live for real third-party funds.
