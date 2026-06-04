// GET /api/settlement → live engine status: reconciliation + open windows.
import { getCollection } from "../lib/store.js";
import { reconcile, tick } from "../lib/settlement.js";

export default async function handler(req, res) {
  if (req.method !== "GET") { res.status(405).json({ error: "Method not allowed" }); return; }
  const agents = await getCollection("agents");
  const ledger = tick(await getCollection("ledger"));
  const recon = reconcile(agents);
  const now = Date.now();
  const windows = ledger
    .filter((e) => e.status === "settling" || e.status === "claimable")
    .map((e) => ({
      id: e.id,
      kind: e.status === "settling" ? "trade-close" : "claim",
      msLeft: Math.max(0, (e.closeDeadline || e.claimDeadline || now) - now),
    }));
  res.status(200).json({
    epoch: now,
    reconciliation: recon,
    openWindows: windows,
    summary: {
      balanced: recon.balanced,
      settling: ledger.filter((e) => e.status === "settling").length,
      claimable: ledger.filter((e) => e.status === "claimable").length,
      pending: ledger.filter((e) => e.status === "pending").length,
    },
  });
}
