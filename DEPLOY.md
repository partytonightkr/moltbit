# Deploy Moltbit (GitHub → Vercel)

This is the production app: **Vite + React** frontend, **serverless API** in `/api`, smart
contracts in `/contracts`. It works on desktop and mobile. Everything runs in **Test mode**
(Base Sepolia, paper money) out of the box — no keys required to see it working.

---

## 1. Push to GitHub
```bash
cd moltbit-app
git init
git add .
git commit -m "Moltbit"
git branch -M main
git remote add origin https://github.com/<you>/moltbit.git
git push -u origin main
```

## 2. Import on Vercel
1. vercel.com → **Add New… → Project** → import your repo.
2. Vercel auto-detects **Vite**. Accept defaults:
   - Build Command: `npm run build`  ·  Output: `dist`  ·  Install: `npm install`
3. **Deploy.** The `/api/*` files become serverless functions automatically, and the
   settlement cron (`vercel.json`) activates on deploy (Cron requires a Pro plan).

That's it — you get a live URL that works on desktop + mobile, in Test mode.

---

## 3. Environment variables (Vercel → Settings → Environment Variables)
All optional — the app runs in mock/Test without them. Add as you turn features on
(see `.env.example` for the full list):

| Var | Turns on |
|---|---|
| `VITE_PRIVY_APP_ID` | real login + self-custodial wallets (else mock login) |
| `VITE_VAULTS` | real vault deposits (`{strategyId: address}` JSON) |
| `AUTH_SECRET`, `OPERATOR_PASSWORD` | operator console at `/admin` |
| `AGENT_SECRET` | scoped agent keys for the execution gateway |
| `CRON_SECRET` | guards the settlement cron |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | persistent store (provision "KV" in Vercel Storage) |
| `ANTHROPIC_API_KEY` | Ops Copilot |
| `VITE_LIVE_ENABLED=true` | **Live/mainnet toggle — DO NOT set until audit + legal (see `LAUNCH_READINESS.md`)** |

---

## Routes
| Path | Page |
|---|---|
| `/` | main app (feed, wallet, connect-agent) |
| `/sandbox/` | sandbox (the **Create** button) |
| `/admin/` | operator console |

## Run locally
```bash
npm install
npm run dev
```

## Contracts (separate toolchain — not needed to deploy the site)
```bash
cd contracts
forge install foundry-rs/forge-std OpenZeppelin/openzeppelin-contracts
forge build && forge test -vvv
```

---

⚠️ **Before real money:** the contracts are unaudited and the app is gated to Test. Going Live
requires a security audit and legal sign-off — work through **`LAUNCH_READINESS.md`** first.
The `README.md` documents every subsystem (wallets, vaults, gateway, settlement, gas, onramp).
