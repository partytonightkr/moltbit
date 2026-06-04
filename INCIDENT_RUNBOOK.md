# Incident Runbook — Moltbit

Operational procedures for halting, diagnosing, and recovering. Pair this with the
launch gate in `LAUNCH_READINESS.md`. **The golden rule: exits are always open.**
Pausing (single or global) blocks deposits and new agent allocation; it never blocks
`requestRedeem` / `claim`. When in doubt, pause — it is reversible and depositors can
still withdraw.

## 0. Who/what to reach
- **Alerts** land via `lib/alert.js` → `ALERT_WEBHOOK_URL` (Slack/Discord) and Vercel logs.
  Key events: `reconcile.imbalance`, `agent.daily_loss_halt`, `agent.kill_switch`,
  `ops.global_pause`, `settlement.reportNav_failed`, `settlement.crank_failed`,
  `settlement.cron_failed`.
- **Operator console:** `/ops` (sign in with `OPERATOR_PASSWORD`).
- On-chain admin is the `DEFAULT_ADMIN_ROLE` multisig; keeper is the settlement key.

## 1. Halt one agent (suspect strategy / runaway)
1. `/ops` → find the agent → **HALT** (or `POST /api/kill { agentId, reason }`).
2. Effect: status → `halted` (gateway denies its orders), vault `setPaused(true)`,
   positions flattened, `agent.kill_switch` alert fired.
3. Verify: the agent shows `halted` in `/ops`; on-chain `paused()` is true.

## 2. Global pause (systemic event: oracle/venue outage, exploit suspicion)
1. `/ops` → **PAUSE ALL** (or `POST /api/pause-all { reason }`).
2. Effect: every agent halted, every vault `setPaused(true)`, `ops.global_pause` alert.
3. This is the fleet-wide brake. Use it first and ask questions second — it is
   idempotent and exits remain open.

## 3. Reconcile break (`reconcile.imbalance`, `balanced === false`)
Σ shares × NAV no longer equals reported backing for some strategy.
1. **Pause the affected vault(s)** (§1) to stop minting/allocating against bad NAV.
2. Inspect the alert `offenders[]` (per-strategy `diff`). Cross-check the keeper's
   off-chain accounting against on-chain `reportedAssets` / `pricePerShare()`.
3. Root-cause: stale/incorrect NAV report, a missed settlement tick, or a venue
   balance the keeper isn't seeing. Fix the input, re-run `reportNav`, confirm
   `reconcile()` is balanced, then unpause.

## 4. NAV anomaly / keeper guardrail (`NavDeltaTooLarge`)
A `reportNav` was rejected on-chain because the move exceeded `maxNavDeltaBps`.
1. Confirm whether the large move is real (big legitimate PnL) or a bug/compromise.
2. If real and safe: admin raises `maxNavDeltaBps` temporarily, report, then restore.
3. If suspect: keep it rejected, pause, investigate the keeper. **Do not** widen the
   bound to push through an unexplained move.

## 5. Daily-loss auto-pause (`agent.daily_loss_halt`)
The gateway auto-paused an agent after realized loss hit its `dailyLoss` limit.
1. Review the agent's recent orders/fills. If acceptable, the agent resumes next
   day (or admin reviews and re-enables). If not, leave halted and investigate.

## 6. Agent key compromise
1. **Revoke immediately:** `PATCH /api/agents { id, action: "revoke" }` — the gateway
   rejects the key on the next order (`keyActive` → false).
2. Issue a fresh key: `PATCH /api/agents { id, action: "rotate" }` (bumps `keyVersion`,
   returns the new key once; the old key is now superseded as well as revoked).
3. If the leak might extend to server secrets, rotate `AGENT_SECRET` / `AUTH_SECRET`
   in the env (this invalidates ALL keys/tokens — coordinate before doing it).

## 7. Settlement cron failures (`settlement.cron_failed` / `*_failed`)
1. The off-chain ledger is the source of truth between epochs; a failed cron delays
   on-chain `reportNav`/`crank` but does not lose funds.
2. Re-run manually: `POST /api/cron/settle` with `Authorization: Bearer $CRON_SECRET`.
3. If on-chain steps fail (server wallet / RPC), fix the cause and re-run; `crank` is
   permissionless after the trade-close deadline, so withdrawals still progress.

## 8. Recovery / unpause checklist
Only unpause when the root cause is fixed and verified:
- [ ] Reconcile balanced for the affected vault(s).
- [ ] NAV reports sane and within `maxNavDeltaBps`.
- [ ] No outstanding alerts.
- [ ] On-chain: admin/keeper calls `setPaused(false)` per vault; agents re-enabled.
- [ ] Post-incident note recorded (what tripped, what was done, follow-ups).
