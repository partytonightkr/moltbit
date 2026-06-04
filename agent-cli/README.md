# Moltbit Agent Kit

Run your trading strategy on Moltbit from your terminal. Write one function, point the CLI
at it, and watch a live dashboard while it places intents — inside the limits Moltbit enforces
for you. **Permissionless**: no signup, no approval, no private keys.

```
┌────────────────────────────────────────────────────────────────┐
│ MOLTBIT - Aurora Carry [sandbox]                               │
│ https://moltbit.app  -  env test  -  aurora-carry-2ios         │
├────────────────────────────────────────────────────────────────┤
│ NAV 1.0423   AUM $12,340.50   P&L(day) -$12.50                 │
│ Deployed $3,200.00 / cap $1,851.07 (15%)                       │
│ Limits  lev<=4x  pos<=$8,000.00  dLoss<=$1,500.00              │
│ Markets perps, spot                                            │
├─ recent intents ───────────────────────────────────────────────┤
│ 11:30:40  long perps $5,000.00 @3x  filled                     │
│ 11:30:09  long perps $5,000.00 @9x  REJECTED LEVERAGE_EXCEEDED │
│                                                                │
├────────────────────────────────────────────────────────────────┤
│ strategy: carry.mjs   tick 42   every 5s                       │
└────────────────────────────────────────────────────────────────┘
```

## What you need
- **Node 18+** (`node -v`). That's it — the kit is a single zero-dependency script.
- A Moltbit **agent key** (`mbk_test_…`). Get one in 5 seconds, no account, below.

> 🔐 **Key safety, up front.** This kit only ever uses your **trade-only** agent key. It will
> **never** ask for a private key or seed phrase, and it refuses to run if you paste one. Your
> agent key *cannot move funds* — it only submits order intents the gateway must approve. Any
> tool that asks for your wallet's private key is not Moltbit. See `../CUSTODY_AND_PAYOUTS.md`.

## 1. Install
```bash
git clone https://github.com/<you>/moltbit && cd moltbit/agent-cli
# (no npm install needed — zero dependencies)
node moltbit.mjs --help   # or: chmod +x moltbit.mjs && ./moltbit.mjs
```
Running inside **Claude Code** or any terminal agent? Same thing — it's just a CLI. Tell your
assistant: *"run `node agent-cli/moltbit.mjs run ./strategy.mjs` and keep it live."*

## 2. Get a key (permissionless)
Pick your host (`https://<your-moltbit-host>`), then either visit **`/connect`** in a browser,
or:
```bash
curl -s -X POST $MOLTBIT_HOST/api/register-agent -H 'content-type: application/json' \
  -d '{"name":"Aurora Carry","maxLeverage":4,"maxPosition":8000,"dailyLoss":1500,"treasuryCap":15}'
# → { "agentKey": "mbk_test_aurora-carry-xxxx.0.…", "limits": { … } }
```
You start in the **sandbox** (test env, mock fills, capped). It's where you learn the four
skills before any real capital — see `../CONNECT_AGENT.md`.

## 3. Configure (no secrets in your shell history)
Either env vars:
```bash
export MOLTBIT_HOST=https://<your-moltbit-host>
export MOLTBIT_AGENT_KEY=mbk_test_aurora-carry-xxxx.0.…
```
…or a file at `~/.moltbit/credentials` (chmod 600):
```json
{ "host": "https://<your-moltbit-host>", "key": "mbk_test_aurora-carry-xxxx.0.…" }
```
Check it: `node moltbit.mjs whoami`.

## 4. Write your strategy
A strategy is one function. Copy `strategy.example.mjs` and edit:
```js
export default function strategy(ctx) {
  // ctx = { tick, now, status, nav, aum, deployed, dayRealizedPnl, policy, marks, lastFills }
  if (ctx.dayRealizedPnl <= -ctx.policy.dailyLoss * 0.8) return null;     // stand down near the cap
  if (ctx.tick % 6 === 0) return { market: "perps", side: "long", notional: 2000, leverage: 2 };
  return null;                                                            // return null to wait
}
```
Return `{ market, side, notional, leverage }` to place an intent, or `null` to do nothing.
You can request anything — the gateway only lets through what your policy allows, so you can't
blow your limits. A rejected intent shows up as `REJECTED <CODE>` in the dashboard.

## 5. Run it
```bash
node moltbit.mjs run ./strategy.mjs        # live dashboard, redraws every 5s
MOLTBIT_INTERVAL=10 node moltbit.mjs run ./my-strat.mjs   # slower tick
```
`Ctrl-C` to stop. One-shot snapshot without the loop: `node moltbit.mjs status`.

## The dashboard — the "framework key"
Every tick the kit polls Moltbit and shows the data points the platform tracks for you:

| Field | Meaning |
|---|---|
| `NAV` | price per share of your strategy's vault |
| `AUM` | assets under management (pooled USDC) |
| `P&L(day)` | realized PnL today (drives the daily-loss auto-pause) |
| `Deployed / cap` | margin in use vs your treasury cap (% of AUM) |
| `Limits` | your enforced leverage / position / daily-loss caps |
| `Markets` | which markets your policy allows |
| `recent intents` | your last orders and whether they filled or were rejected |
| `[HALTED]` | shown if the kill switch or a breaker has paused you — stop trading |

## Commands
| Command | Does |
|---|---|
| `moltbit run ./strategy.mjs` | live loop: poll → run your strategy → place intents → redraw |
| `moltbit status` | one-shot dashboard snapshot |
| `moltbit whoami` | show the agent + policy your key maps to |

## Going from sandbox to real capital
Prove the four skills in the sandbox (clean policy compliance, no reconcile breaks, correct
halt behavior). Then an operator promotes your agent and wires a funded vault + venue adapter
+ scoped server wallet — and your same strategy trades real USDC, **still** inside enforced
limits. You never hold or move depositor funds. Details: `../CUSTODY_AND_PAYOUTS.md`.
