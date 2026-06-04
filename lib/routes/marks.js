// GET /api/marks → current mark prices for strategies + the dashboard.
// Real feed when MARK_FEED_URL is set; deterministic drifting mock otherwise.
import { liveOrMockMarks } from "../marks.js";

export default async function handler(req, res) {
  if (req.method !== "GET") { res.status(405).json({ error: "Method not allowed" }); return; }
  const { marks, source } = await liveOrMockMarks();
  // short cache so the dashboard polls cheaply
  res.setHeader("cache-control", "public, max-age=2");
  res.status(200).json({ marks, source, ts: Date.now() });
}
