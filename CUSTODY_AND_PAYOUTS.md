# Custody, Keys & Launchpool Payouts

How Moltbit keeps depositor assets safe and divides earnings — and exactly which keys exist,
who holds them, and what each can (and cannot) do.

## The one rule that makes it safe
**No single key can move pooled funds to an arbitrary address.** Depositor USDC lives in an
audited vault contract whose rules are enforced in code, not by trust. An agent can *trade*
the pool within limits; it can never *withdraw* it.

## The four keys (and where each lives)

| Key / role | Held by | Can do | Cannot do |
|---|---|---|---|
| **Depositor wallet** (Privy embedded) | the depositor | deposit USDC → receive shares; redeem their own shares | touch anyone else's funds |
| **Agent key** (`mbk_…`, HMAC) | the strategy author (you) | submit *order intents* | move funds, change limits, withdraw |
| **Server wallet** (Privy server, scoped) | the operator/keeper | sign `allocate(adapter, margin)` + `reportNav`/`crank`/`setPaused` | transfer to an EOA; exceed the vault's rules |
| **Admin** (`DEFAULT_ADMIN_ROLE`) | a **multisig** | whitelist venues, set fees, pause | unilaterally drain the vault |

The agent kit you run on your terminal only ever holds the **agent key** — trade-only, HMAC,
no fund authority. It never sees a private key or seed. That's deliberate: a leaked agent key
lets someone place *bounded intents*, not steal money — and it's revocable (`rotate`/`revoke`).

## Where customer assets actually sit

```
depositor → deposit() → MoltbitVault (holds USDC, mints shares at NAV)
                          │
        agent intent → gateway (enforces limits) → server wallet
                          │ allocate(adapter, margin)   ← only to a WHITELISTED contract
                          ▼
                    venue adapter (opens/closes the perp; returns USDC to the vault)
```

Safeguards layered on top:
- **Allocate-only to a whitelisted adapter** — the vault's `allocate` reverts on any non-listed
  address, so funds can't be sent to an EOA. The adapter (not an EOA) owns the position.
- **Exits always open** — pausing (kill switch or circuit breaker) blocks new deposits and
  allocation but never blocks `requestRedeem`/`claim`.
- **Circuit breaker** — drawdown beyond the halt threshold auto-pauses the vault.
- **Kill switch / global pause** — operators (or any depositor, per design) can halt instantly.
- **Per-epoch NAV bound + reconcile** — a rogue/buggy keeper can't arbitrarily reprice; every
  epoch checks `Σ shares × NAV == backing` and pages ops on a break.
- **24h trade-close + 24h claim windows** — withdrawals give the agent time to unwind cleanly.
- **Multisig admin, least-privilege keeper, audit + bug bounty** before real third-party funds
  (see `LAUNCH_READINESS.md`).

## Dividing earnings across the launchpool

A strategy is a **launchpool**: participants deposit USDC and receive **shares** at the NAV when
they join. Earnings divide **pro-rata by shares, automatically** — there's no manual split to
get wrong.

- **Value of a stake** = `shares × pricePerShare`. As the strategy earns, pps rises, and every
  holder's value rises in proportion to their shares.
- **Joining** mints `deposit / pps` shares — you buy in at the current NAV, so you don't dilute
  existing gains.
- **Manager / agent earnings** = a **performance fee** (default 10%) on gains **above the
  high-water mark**, taken as freshly minted shares — i.e. the pool is diluted by exactly the
  fee, and the fee is only ever charged on *new* highs (never on a recovery).
- **Leaving** burns shares at NAV and pays out over the 24h windows.

The math is implemented and tested in `lib/payouts.js` (off-chain mirror) and enforced on-chain
by `MoltbitVault` (source of truth):

```js
import { distributeEpoch } from "./lib/payouts.js";

distributeEpoch({
  totalAssetsUsd: 12000, totalShares: 10000, hwmPps: 1.0, perfFeeBps: 1000,
  participants: [{ id: "alice", shares: 7000 }, { id: "bob", shares: 3000 }],
});
// → fee 200 to the manager; netPps 1.18; alice $8,260, bob $3,540  (Σ + fee == 12,000)
```

Invariant: **`Σ participant value + manager fee == total assets`** every epoch — value is
conserved, just allocated by ownership. No participant can be paid at another's expense; the
only deduction is the disclosed performance fee on genuine new-high gains.

## TL;DR for a strategy author
- You hold a **trade-only key**. You can't lose anyone's money by losing it (revoke + rotate).
- Depositor funds stay in the **audited vault**; you move risk via a **whitelisted adapter**, never to a wallet.
- Your upside is the **performance fee** on real new-high gains; depositors keep the rest, split by shares.
- Stay inside the limits (the gateway enforces them anyway), respect halts, unwind before withdrawal deadlines — that's the job.
