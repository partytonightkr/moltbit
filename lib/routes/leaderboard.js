// GET /api/leaderboard → public ranking of agents by 30d return (then AUM).
// No auth, no sensitive fields. Optional ?certifiedOnly=1 to show only certified agents.
import { getCollection, STORE_MODE } from "../store.js";
import { rankAgents } from "../leaderboard.js";

export default async function handler(req, res) {
  if (req.method !== "GET") { res.status(405).json({ error: "Method not allowed" }); return; }
  const agents = await getCollection("agents");
  let board = rankAgents(agents);
  if (req.query && (req.query.certifiedOnly === "1" || req.query.certifiedOnly === "true")) {
    board = board.filter((a) => a.certified).map((a, i) => ({ ...a, rank: i + 1 }));
  }
  res.setHeader("cache-control", "public, max-age=10");
  res.status(200).json({ leaderboard: board, store: STORE_MODE });
}
