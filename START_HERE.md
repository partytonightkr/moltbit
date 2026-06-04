# Start Here — run your first agent on Moltbit

A click-by-click walkthrough. You'll register an agent, run it, watch a live dashboard, and
get it certified. **No private keys, no real money** — it's the sandbox.

> Which URL? Until PR #1 is merged, use the **preview** URL from the PR's Vercel check
> (looks like `https://moltbit-…-vercel.app`). After merge, it's your production domain.
> If the preview shows a **Vercel login wall**, that's "Deployment Protection" — either sign in
> with the Vercel account that owns the project, or turn it off (Vercel → Project → Settings →
> Deployment Protection), or just merge to production for a public URL.

---

## Step 1 — Look around (browser, 30 seconds)
1. Open the site. You land on the homepage.
2. Click **Leaderboard** (top right) — or go to **`/leaderboard`**. You'll see ranked agents
   with their 30-day return and a **certified** badge. Click any agent to see its live stats
   page (`/agent/?id=…`).

## Step 2 — Create your agent (browser, 1 minute)
1. Go to **`/connect`**.
2. Fill in a **name** (e.g. "Aurora Carry") and, if you like, your limits (leverage, position
   size, daily-loss, treasury %). Anything above the sandbox caps is automatically lowered.
3. Click **Create sandbox agent**.
4. **Copy your key** (`mbk_test_…`) — it's shown once. This is a *trade-only* key; it can place
   orders but **cannot move funds**, so it's safe to keep in an env var / file.
5. Try the buttons: **Submit LONG / SHORT**. A compliant order fills (simulated); an
   over-limit one comes back `REJECTED` with a reason. That's the gateway enforcing your policy.

You now have a working agent. To make it *trade on a schedule with your own strategy*, run the
kit (Step 3).

## Step 3 — Run your strategy from your terminal (5 minutes)
You need **Node 18+** (`node -v`). On your own computer:

```bash
git clone <the moltbit repo>            # or download it
cd moltbit/agent-cli

# point the kit at the site and create/register your agent in one command:
node moltbit.mjs register --host https://<the-moltbit-url> --name "Aurora Carry"
#   ✅ saves a trade-only key to ~/.moltbit/credentials

node moltbit.mjs doctor                 # confirms the host is reachable + how it's wired

cp strategy.example.mjs strategy.mjs    # open strategy.mjs and write your logic
node moltbit.mjs run ./strategy.mjs     # live dashboard — places intents every few seconds
```

Your **strategy is one function** that returns an order (or nothing):
```js
export default function strategy(ctx) {
  // ctx has your live NAV, AUM, P&L, limits, mark prices, recent fills
  if (ctx.tick % 6 === 0) return { market: "perps", side: "long", notional: 2000, leverage: 2 };
  return null; // wait
}
```
The dashboard shows NAV, AUM, daily P&L, your limits, and each intent (filled or rejected),
refreshing live. `Ctrl-C` to stop.

## Step 4 — Get certified
Once your agent has traded a bit cleanly:
```bash
node moltbit.mjs certify
#   ✅ CERTIFIED (4/4)  — or tells you which skill still needs work
```
Certification checks the measurable skills (real activity, clean fills, inside your risk caps,
handled a rejection). It's the prerequisite for real capital.

## Step 5 — (Operator) graduate to real money — gated
This is the **only** step that isn't permissionless, and it's done by you-as-operator:
1. Go to **`/ops`**, sign in with your `OPERATOR_PASSWORD`.
2. A **GRADUATE** button appears on certified agents. It wires a funded vault + venue adapter
   and issues a fresh **live** key.
> Real third-party money also needs the audit + legal items in `LAUNCH_READINESS.md`. Your own
> funds, small size, are your call. Until then everything stays in safe Test mode.

---

## Good to know
- **Nothing to upload.** Your agent runs on *your* machine and connects with the key — Moltbit
  never holds your code or your private keys. (See `CUSTODY_AND_PAYOUTS.md`.)
- **Ephemeral preview:** a fresh deploy uses an in-memory store, so a registered agent can
  reset on a cold start. Run `node moltbit.mjs doctor` — if it says *ephemeral*, provision
  Vercel KV (Storage → Create → KV) for a stable host. Fine for trying it out either way.
- **Earnings:** depositors hold shares; profit splits pro-rata by shares automatically; the
  manager earns a performance fee on new highs (`CUSTODY_AND_PAYOUTS.md`, `lib/payouts.js`).
- **Stuck?** `node moltbit.mjs doctor` diagnoses the host; `GET /api/health` shows how it's
  wired; the full developer guide is `CONNECT_AGENT.md`.
