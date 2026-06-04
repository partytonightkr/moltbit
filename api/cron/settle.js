// Settlement cron — runs one epoch of settlement on a schedule.
//   GET/POST /api/cron/settle
// Triggered by Vercel Cron (see vercel.json). Guarded by CRON_SECRET so only the
// scheduler (or an operator with the secret) can run it.
//
// Each run: advance the off-chain ledger (strike deposits, close/settle the 24h
// windows), reconcile, and — when vaults are live — push NAV + crank on-chain via
// the Privy server wallet. All on-chain steps are mock-safe until keys are set.
import { getCollection, setCollection, STORE_MODE } from "../../lib/store.js";
import { runEpoch } from "../../lib/worker.js";
import { reportNavOnchain, crankOnchain, SERVER_WALLET_MODE } from "../../lib/serverWallet.js";
import { alert } from "../../lib/alert.js";

const CRON_SECRET = process.env.CRON_SECRET;

function authorized(req) {
  if (!CRON_SECRET) return true; // unguarded in local/dev when unset
  const hdr = req.headers["authorization"] || "";
  const bearer = hdr.startsWith("Bearer ") ? hdr.slice(7) : null;
  // Vercel Cron sends Authorization: Bearer <CRON_SECRET>
  return bearer === CRON_SECRET || req.headers["x-cron-secret"] === CRON_SECRET;
}

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  if (!authorized(req)) {
    res.status(401).json({ error: "unauthorized cron" });
    return;
  }

  const now = Date.now();
  try {
    const [ledgerIn, agents] = await Promise.all([
      getCollection("ledger"),
      getCollection("agents"),
    ]);

    // 1. off-chain epoch
    const { ledger, summary } = runEpoch(ledgerIn, agents, now);
    await setCollection("ledger", ledger);

    // reconcile break → page someone (the single most important settlement alert)
    if (!summary.balanced) {
      const offenders = (summary.reconciliation?.rows || []).filter((r) => !r.ok);
      await alert("reconcile.imbalance", { epoch: summary.epoch, offenders }, "error");
    }

    // 2. on-chain: report NAV + crank expired windows (mock-safe)
    const onchain = [];
    for (const a of agents) {
      if (!a.vaultAddress) continue;
      try {
        const reportedAssets = Math.round(Number(a.aum || 0) * 1e6 * 1e6) / 1e6; // $M → USD(6dp)
        const nav = await reportNavOnchain({
          env: a.env || "test",
          vaultAddress: a.vaultAddress,
          reportedAssets,
          walletId: a.serverWalletId || null,
        });
        onchain.push({ agent: a.id, action: "reportNav", txHash: nav.txHash, mode: nav.mode });
      } catch (e) {
        onchain.push({ agent: a.id, action: "reportNav", error: String(e.message || e) });
        await alert("settlement.reportNav_failed", { agent: a.id, error: String(e.message || e) }, "error");
      }
    }

    // crank any ledger ids that just need force-closing on-chain
    const crankIds = ledger
      .filter((e) => e.type === "withdrawal" && e.status === "claimable")
      .map((e) => e.onchainId)
      .filter((x) => x != null);
    if (crankIds.length) {
      try {
        const c = await crankOnchain({ env: "test", vaultAddress: agents[0]?.vaultAddress, ids: crankIds });
        onchain.push({ action: "crank", ids: crankIds, txHash: c.txHash, mode: c.mode });
      } catch (e) {
        onchain.push({ action: "crank", error: String(e.message || e) });
        await alert("settlement.crank_failed", { ids: crankIds, error: String(e.message || e) }, "error");
      }
    }

    res.status(200).json({
      ok: true,
      store: STORE_MODE,
      serverWallet: SERVER_WALLET_MODE,
      ...summary,
      onchain,
    });
  } catch (e) {
    // a thrown cron is invisible unless we shout — page on hard failure
    await alert("settlement.cron_failed", { epoch: now, error: String(e.message || e) }, "error");
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
}
