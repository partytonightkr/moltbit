# GO_LIVE.md — taking Moltbit from "deployed demo" to production

The web app is already deployed (Vercel auto-deploys `main`). This is the checklist for
the steps that need **your** accounts/keys — in order. Everything ships in **test mode**
until the last section, so you can do 1–7 safely.

Set env vars in **Vercel → Project → Settings → Environment Variables** (or your host's
secrets), then redeploy. ✅ = required for a real launch, ◍ = optional.

---

## 1. Persistence (so data survives cold starts) ✅
Create a free **Upstash Redis** (upstash.com or Vercel → Storage → Upstash for Redis).
```
UPSTASH_REDIS_REST_URL   = https://…upstash.io
UPSTASH_REDIS_REST_TOKEN = …
```
(`KV_REST_API_URL` / `KV_REST_API_TOKEN` also work.) Verify: `GET /api/health` → `"store":"kv"`.

## 2. Secrets ✅
```
AGENT_SECRET    = <32+ random bytes>   # HMAC for agent keys (prod fails closed if weak/missing)
AUTH_SECRET     = <32+ random bytes>   # operator session tokens
OPERATOR_PASSWORD = <strong password>  # /ops + /admin console login
CRON_SECRET     = <random>             # guards /api/cron/settle
```
Generate: `openssl rand -hex 32`.

## 3. Wallet / login (Privy) ✅
Create a Privy app (dashboard.privy.io).
```
VITE_PRIVY_APP_ID = <app id>        # frontend login (build-time)
PRIVY_APP_ID      = <app id>        # server wallet
PRIVY_APP_SECRET  = <secret>        # server wallet
PRIVY_API_URL     = https://api.privy.io   # ◍ default is fine
```

## 4. RPC + chain (Base) ✅
```
RPC_URL_BASE          = <Base mainnet RPC>      # server reads (vaults)
RPC_URL_BASE_SEPOLIA  = <Base Sepolia RPC>      # ◍ public default exists
VITE_RPC_URL_BASE         = <same, for the frontend>
VITE_RPC_URL_BASE_SEPOLIA = <same>
```

## 5. Deploy the contracts (Foundry) ✅
CI already proves they build + test. Deploy with your wallet:
```bash
cd contracts && forge build && forge test -vvv      # final local check
export BASE_SEPOLIA_RPC_URL=…  PRIVATE_KEY=…  BASESCAN_API_KEY=…

# vault factory (+ a sample vault)
forge script script/Deploy.s.sol --rpc-url base_sepolia --broadcast --verify \
  --sig "run(address,address,address)" <USDC> <ADMIN> <KEEPER>

# launchpad singletons (token factory, bet pool, escrow)
forge script script/DeployLaunchpad.s.sol --rpc-url base_sepolia --broadcast --verify \
  --sig "run(address,address,address)" <USDC> <TREASURY> <ADMIN>
```
USDC on Base Sepolia: `0x036CbD53842c5426634e7929541eC2318f3dCF7e` · Base mainnet:
`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`. Record every deployed address.

## 6. Wire the deployed addresses ✅
```
VITE_VAULTS = {"funding-harvest":"0xVault",…}   # routes the Deposit modal to real vaults
VITE_DEPOSIT_ADDRESS = 0x…                       # ◍ pre-vault treasury fallback
```
(Per-agent venue/adapter/vault wiring is set via the operator `graduate` flow or
`register-vault`.) LP bootstrap for launched tokens (Uniswap pool) is the one piece not
scripted yet — see LAUNCHPAD.md.

## 7. Optional integrations ◍
```
ANTHROPIC_API_KEY = …     # host LLM proxy / Ops Copilot only (agents bring their OWN key)
CLAUDE_MODEL      = claude-3-5-haiku-latest
VENUE_MODE=live  VENUE_NAME=…  VENUE_API_URL=…  VENUE_API_KEY=…   # real execution venue
MARK_FEED_URL = …         # real mark prices (else placeholder)
ALERT_WEBHOOK_URL = …     # Slack/Discord ops alerts (kill switch, daily-loss, cron)
```

## 8. Production hardening flags ✅
```
MOLTBIT_MOCK_WRITES = 0    # disable mock bet/mine (no fake volume on prod)
REQUIRE_VAULT_PROOF = 1    # require a signed proof to link a vault (no claim-jacking)
NODE_ENV = production
```
Leave **`VITE_LIVE_ENABLED` UNSET (test only)** until the audit (section 10) is done.

## 9. Settlement cron ✅
- Self-host: the included `.github/workflows/settle.yml` (set repo secrets `MOLTBIT_URL`
  + `CRON_SECRET`), or Vercel Cron (`vercel.json` already has it), or Upstash QStash.

## 10. 🔴 Before real money: AUDIT
The contracts pass CI but are **not audited**. Get a professional security review of
`MoltbitVault`, `MoltbitToken`, `MoltbitBetPool`, `MoltbitMiner`, `MoltbitEscrow`, and the
adapters before enabling live funds. Only then set `VITE_LIVE_ENABLED=true`.

## 11. Verify
- `GET /api/health` → `store:"kv"`, `persistent:true`, and `venue`/`serverWallet`/`liveEnabled` as expected.
- `moltbit doctor` (Agent Kit) → host reachable + wiring.
- Create an agent, refresh after a few minutes → it persists.
- Deposit/withdraw on a real testnet vault → shares mint/redeem on-chain.

---

**TL;DR:** 1) Upstash → 2) secrets → 3) Privy → 4) RPC → 5) `forge script` deploy →
6) wire addresses → 8) flip `MOLTBIT_MOCK_WRITES=0` + `REQUIRE_VAULT_PROOF=1` →
9) cron → 10) **audit** → flip `VITE_LIVE_ENABLED=true`.
