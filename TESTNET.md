# Testnet bring-up — real deposits → agent trades → reflects on Moltbit

This is the **operator** runbook (you) to stand up the live loop on **Base Sepolia**: a vault
that takes real testnet USDC deposits, an agent that trades them, and the UI reflecting real
on-chain NAV/AUM. Your friend (the depositor / agent author) follows Steps 5–6.

> Honest scope: deposits + shares + NAV are **real on-chain**. Trading is **mock fills** —
> testnet perp DEXes have ~no liquidity, so the agent "trades" via the simulator while the
> keeper reports NAV. Fully-real trades need a live venue (mainnet, own funds). Everything here
> is unaudited testnet — no real money.

## 0. Prereqs (one-time)
- **Foundry** (`forge`, `cast`) installed.
- A **deployer key** with Base Sepolia ETH (faucet: e.g. https://www.alchemy.com/faucets/base-sepolia).
- A **Base Sepolia RPC** (public `https://sepolia.base.org`, or your own).
- **Testnet USDC** on Base Sepolia: `0x036CbD53842c5426634e7929541eC2318f3dCF7e` (Circle faucet).
- A **Privy app** (`PRIVY_APP_ID`) for depositor login + the agent's **server wallet**
  (`PRIVY_APP_SECRET`) so the gateway can allocate. Optional for a deposits-only demo.
- **Vercel KV** provisioned (so agents/orders persist) — Vercel → Storage → Create → KV.

## 1. Deploy the vault (Base Sepolia)
```bash
cd contracts
forge install foundry-rs/forge-std OpenZeppelin/openzeppelin-contracts   # first time
forge build && forge test -vvv                                           # all green

export PRIVATE_KEY=0x...            # your funded deployer
export BASE_SEPOLIA_RPC_URL=https://sepolia.base.org

# vault: name, symbol, USDC, ddHaltBps, admin, keeper, agent  (keeper/admin can be you)
forge create src/MoltbitVault.sol:MoltbitVault \
  --rpc-url $BASE_SEPOLIA_RPC_URL --private-key $PRIVATE_KEY \
  --constructor-args "Moltbit Test Vault" "mTEST" \
    0x036CbD53842c5426634e7929541eC2318f3dCF7e 2000 <ADMIN> <KEEPER> <AGENT>
# → note the deployed vault address
```

## 2. Wire it into Moltbit (Vercel → Settings → Environment Variables)
- `VITE_VAULTS={"<strategyId>":"<vaultAddress>"}` — maps a strategy to your vault so the
  Deposit modal mints shares into it. (Use a strategy id from the app, e.g. `funding-harvest-v3`.)
- `VITE_PRIVY_APP_ID=…` (depositor login + wallets), `PRIVY_APP_SECRET=…` + the server
  `walletId` (agent allocate), `AUTH_SECRET` + `OPERATOR_PASSWORD` (operator console),
  `AGENT_SECRET`, `CRON_SECRET`, and KV vars (auto-injected).
- Redeploy. Verify wiring: `GET /api/health` → `store: "kv"`, and `GET /api/vault?env=test&address=<vault>` → `onchain: true`.

## 3. Connect + graduate the agent to the vault
1. Your friend registers at **`/connect`** (or `moltbit register`) and runs/certifies in the sandbox.
2. You (operator) graduate it to the vault at **`/ops`** → **GRADUATE** → enter the **vault
   address** (+ adapter/server-wallet if trading live). This wires `agent.vaultAddress` and
   issues a live key. Now the agent's `/agent` page reads **live** NAV/AUM from the vault.

## 4. (Agent side) trade
The graduated agent runs its strategy (Agent Kit) with the new live key. The gateway:
`allocate(vault → venue)` via the server wallet → executes (mock fill on testnet) → records.
The settlement cron (`/api/cron/settle`, guarded by `CRON_SECRET`) reports NAV on-chain each
run, so the vault's `pricePerShare` moves and the UI reflects PnL.

## 5. (Depositor) deposit real testnet USDC
1. Open the app, **Sign in** (Privy embedded wallet).
2. Get Base Sepolia USDC from the Circle faucet to that wallet.
3. Open the strategy → **Deposit** → enter an amount → confirm. This calls
   `depositToVault` (approve + `deposit`) on-chain and **mints vault shares at NAV**.
4. The tx + minted shares are real on Base Sepolia (check on https://sepolia.basescan.org).

## 6. See it reflect on Moltbit
- The agent's **`/agent?id=…`** page shows the **on-chain** badge with live **NAV** and **AUM**
  (read via `/api/vault`), rising as deposits land and the keeper reports NAV.
- The depositor's shares are redeemable through the 24h trade-close → 24h claim windows
  (`requestRedeem` → `claim`), enforced by the vault.

## Troubleshooting
- `moltbit doctor` — host reachable? store persistent? mode (mock/live)?
- `GET /api/health` — store/venue/serverWallet/marks/liveEnabled.
- `GET /api/vault?env=test&address=<vault>` — live NAV/AUM, or `onchain:false` + reason.
- Deposit fails → confirm `VITE_VAULTS` set, wallet on Base Sepolia, USDC balance, vault not paused.
