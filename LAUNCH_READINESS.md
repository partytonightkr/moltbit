# Launch Readiness — gate before Live (mainnet, real third-party funds)

The product is technically complete in **Test** (Base Sepolia, paper money + real market
data). **Live** (Base mainnet, real depositor capital) is hard-gated behind
`VITE_LIVE_ENABLED=true`. Do **not** flip that flag until everything below is done.

> ⚠️ This is an engineering readiness checklist, **not legal advice**. The single most
> important item is professional counsel — everything else is downstream of it.

## 0. Legal & regulatory (do this FIRST)
- [ ] Securities/fintech counsel engaged. Pooling depositor funds into third-party-run
      strategies and sharing returns is likely an **investment contract**; autonomous agents
      trading discretionarily on others' behalf likely implicate **investment-adviser**
      registration (or an exemption) and **offering** registration/exemption.
- [ ] Entity, terms of service, risk disclosures, and depositor agreements drafted + reviewed.
- [ ] Jurisdiction/geofencing decided (who can deposit, from where).
- [ ] AML/sanctions posture decided with counsel (note: Privy provides wallets, not KYC —
      if KYC/AML is required for your model, add a provider before Live).
- [ ] Tax reporting approach for depositor gains.

## 1. Smart contracts
- [ ] `MoltbitVault` + factory **audited** by a reputable firm; findings resolved.
- [~] NAV reporting hardened — **per-epoch deltas now bounded** (`maxNavDeltaBps`, default ±50%);
      still TODO: signed venue attestations, multi-keeper, timelock/oracle. A single trusted
      keeper remains the largest trust assumption today.
- [~] Per-venue **adapter contracts** (so "venue" is an audited strategy adapter, not an EOA).
      `IMoltbitVenueAdapter` + two adapters built and unit-tested: `MoltbitAvantisAdapter`
      (gTrade-style, signatures/addresses reconciled vs the Avantis SDK) and
      `MoltbitSynFuturesAdapter` (Oyster AMM, bit-packed calldata vs the oyster-sdk). The
      gateway routes `venueKind:onchain` agents through the adapter (allocate→open→close→
      returnFromVenue). *Still TODO: audit; cross-check enum/internal logic on Basescan;
      keeper computes SynFutures tick/size off-chain. See `contracts/BRINGUP_BASE_PERPS.md`.*
- [ ] `DEFAULT_ADMIN_ROLE` on a **multisig** (Safe); keeper is a separate least-privilege key.
- [x] Performance-fee accrual implemented + tested (the 10% shown in the UI) — high-water-mark
      fee minted as shares to `feeRecipient` on each new NAV high; covered by Foundry tests.
- [ ] Mainnet deploy + verified; addresses wired into `VITE_VAULTS`.

## 2. Agent execution
- [x] `AGENT_SECRET` is a strong secret; keys rotate-able; revocation path exists.
      Keys are versioned (`mbk_<env>_<id>.<kid>.<sig>`); `rotate`/`revoke`/`restore`
      via `PATCH /api/agents`; gateway enforces `keyActive`; prod fails closed on a
      weak/missing secret. *Still TODO: set the real secret in the env.*
- [~] `VENUE_MODE=live` with a real venue client.
      Two paths: (a) **on-chain** via `MoltbitAvantisAdapter` (preferred for Base perps —
      keeper calls `adapter.openTrade/closeTrade`, no HTTP in the loop); (b) the generic
      REST client (`lib/venue.js → submitLive`, `VENUE_API_URL`) for custodial/off-chain
      venues. *On-chain path: pin the Avantis ABI + exercise a tiny live position.*
- [~] Privy **server wallet** configured; scoped to allocate-only per vault.
      Implemented: real calldata (viem) for allocate/reportNav/crank/setPaused/
      returnFromVenue, submitted via Privy REST (`lib/chainServer.js`). *Still TODO:
      set `PRIVY_APP_ID`+`PRIVY_APP_SECRET`, scope the wallet policy, exercise on testnet.*
- [ ] Policy limits load from on-chain/governance, not just the create payload.
- [~] Kill switch tested end-to-end (UI → gateway → vault pause → flatten).
      Wired end to end: operator console at `/ops` → `POST /api/kill` → halt (gateway
      denies orders) → vault `setPaused` → flatten/return (real calldata, mock-safe
      until Privy keys are set) → ops alert. *Still TODO: exercise on-chain on testnet.*

## 3. Settlement
- [ ] `CRON_SECRET` set; cron running on a schedule that matches the 24h windows.
- [x] On-chain `reportNav`/`crank` exercised on mainnet; **reconciliation alerting wired**
      (`api/cron/settle.js` pages on `balanced === false`, failed reportNav/crank, and
      cron exceptions via `lib/alert.js`). *Mainnet exercise still pending.*
- [ ] Persistent store (Vercel KV) provisioned — not the in-memory fallback.

## 4. Wallets & funding
- [ ] Privy smart wallets + **paymaster** funded (gas sponsorship live; verify zero-ETH deposit).
- [ ] Card onramp provider live and tested for the target geos.
- [ ] Withdrawal/offramp path tested with real (small) amounts.

## 5. Ops & safety
- [~] Monitoring + alerting (NAV drift, reconcile breaks, circuit trips, failed cron).
      `lib/alert.js` centralises alerts (log-only by default; Slack/Discord/generic
      webhook via `ALERT_WEBHOOK_URL`); reconcile breaks, daily-loss halts, kill-switch
      trips and failed crons are wired. *Still TODO: point it at a real channel + add
      NAV-drift thresholds/dashboards.*
- [x] Incident runbook + global pause procedure. `INCIDENT_RUNBOOK.md` covers
      single-agent kill, **global pause** (`POST /api/pause-all` + `/ops` PAUSE ALL),
      reconcile breaks, NAV anomalies, key compromise, and recovery. Operator-token
      surface now fails closed in prod (`AUTH_SECRET`/`OPERATOR_PASSWORD` required).
- [ ] Bug bounty (e.g. Immunefi) before scaling TVL.
- [ ] Start with a **TVL cap** and your own funds; raise limits gradually.

## 6. Flip the switch
Only when 0–5 are complete:
```
VITE_LIVE_ENABLED=true     # enables the Live env toggle in the UI
```
Until then the app runs fully in Test — real wallets, real testnet USDC, real settlement —
with zero exposure to real-money or regulatory risk.
