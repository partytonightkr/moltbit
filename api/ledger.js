// GET  /api/ledger → list (ticked to current time)
// POST /api/ledger { action, id, nav } → advance settlement state (auth)
//   actions: strike | request | close | claim | tick
import { getCollection, setCollection } from "../lib/store.js";
import { requireAuth } from "../lib/auth.js";
import { strikeDeposit, requestWithdrawal, closeTrades, claim, tick } from "../lib/settlement.js";

export default async function handler(req, res) {
  if (req.method === "GET") {
    const ledger = tick(await getCollection("ledger"));
    await setCollection("ledger", ledger);
    res.status(200).json({ ledger });
    return;
  }
  if (req.method === "POST") {
    if (!requireAuth(req, res)) return;
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const { action, id, nav } = body;
    let ledger = await getCollection("ledger");

    if (action === "tick") {
      ledger = tick(ledger);
    } else {
      const i = ledger.findIndex((e) => e.id === id);
      if (i < 0) { res.status(404).json({ error: "ledger entry not found" }); return; }
      const e = ledger[i];
      let updated = e;
      if (action === "strike") updated = strikeDeposit(e, nav || 1.0);
      else if (action === "request") updated = requestWithdrawal(e, nav || e.navAt || 1.0);
      else if (action === "close") updated = closeTrades(e);
      else if (action === "claim") updated = claim(e);
      else { res.status(400).json({ error: "unknown action" }); return; }
      if (updated.error) { res.status(409).json(updated); return; }
      ledger = ledger.map((x, idx) => (idx === i ? updated : x));
    }
    await setCollection("ledger", ledger);
    res.status(200).json({ ledger });
    return;
  }
  res.status(405).json({ error: "Method not allowed" });
}
