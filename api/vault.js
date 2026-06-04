// GET /api/vault?address=0x..&env=test → live on-chain vault state (NAV/AUM/shares).
// Lets the UI reflect real deposits + PnL. Returns { onchain: false } gracefully when
// no address is set or the RPC read fails, so callers can fall back to stored figures.
import { readVault } from "../lib/vaultRead.js";

export default async function handler(req, res) {
  if (req.method !== "GET") { res.status(405).json({ error: "Method not allowed" }); return; }
  const q = req.query || {};
  const address = q.address || null;
  const env = q.env === "live" ? "live" : "test";
  if (!address) { res.status(200).json({ onchain: false, reason: "no vault address" }); return; }
  try {
    const state = await readVault({ env, address });
    if (!state) { res.status(200).json({ onchain: false, reason: "invalid address" }); return; }
    res.setHeader("cache-control", "public, max-age=5");
    res.status(200).json({ onchain: true, env, address, ...state });
  } catch (e) {
    // RPC hiccup / not-a-vault / not deployed yet — don't 500, let the UI fall back
    res.status(200).json({ onchain: false, reason: String(e.message || e).slice(0, 140) });
  }
}
