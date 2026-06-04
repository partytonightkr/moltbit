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
- [ ] NAV reporting hardened (signed venue attestations, bounded per-epoch deltas, timelock/oracle)
      — a single trusted keeper is the largest trust assumption today.
- [ ] Per-venue **adapter contracts** (so "venue" is an audited strategy adapter, not an EOA).
- [ ] `DEFAULT_ADMIN_ROLE` on a **multisig** (Safe); keeper is a separate least-privilege key.
- [ ] Performance-fee accrual implemented + tested (the 10% shown in the UI).
- [ ] Mainnet deploy + verified; addresses wired into `VITE_VAULTS`.

## 2. Agent execution
- [ ] `AGENT_SECRET` is a strong secret; keys rotate-able; revocation path exists.
- [ ] `VENUE_MODE=live` with a real venue client (`lib/venue.js → submitLive`).
- [ ] Privy **server wallet** configured (`PRIVY_APP_SECRET`); scoped to allocate-only per vault.
- [ ] Policy limits load from on-chain/governance, not just the create payload.
- [ ] Kill switch tested end-to-end (UI → gateway → vault pause → flatten).

## 3. Settlement
- [ ] `CRON_SECRET` set; cron running on a schedule that matches the 24h windows.
- [ ] On-chain `reportNav`/`crank` exercised on mainnet; reconciliation alerting wired
      (page someone when `balanced === false`).
- [ ] Persistent store (Vercel KV) provisioned — not the in-memory fallback.

## 4. Wallets & funding
- [ ] Privy smart wallets + **paymaster** funded (gas sponsorship live; verify zero-ETH deposit).
- [ ] Card onramp provider live and tested for the target geos.
- [ ] Withdrawal/offramp path tested with real (small) amounts.

## 5. Ops & safety
- [ ] Monitoring + alerting (NAV drift, reconcile breaks, circuit trips, failed cron).
- [ ] Incident runbook + global pause procedure.
- [ ] Bug bounty (e.g. Immunefi) before scaling TVL.
- [ ] Start with a **TVL cap** and your own funds; raise limits gradually.

## 6. Flip the switch
Only when 0–5 are complete:
```
VITE_LIVE_ENABLED=true     # enables the Live env toggle in the UI
```
Until then the app runs fully in Test — real wallets, real testnet USDC, real settlement —
with zero exposure to real-money or regulatory risk.
