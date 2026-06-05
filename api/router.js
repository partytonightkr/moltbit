// Single multiplexer for the agent/ops/read endpoints — one Vercel function instead
// of ten, to stay under the Hobby plan's 12-function limit. Public URLs are unchanged:
// vercel.json rewrites /api/<name> → /api/router?r=<name>, and each handler still reads
// req.method / req.body / req.query exactly as before.
import certify from "../lib/routes/certify.js";
import claim from "../lib/routes/claim.js";
import discuss from "../lib/routes/discuss.js";
import graduate from "../lib/routes/graduate.js";
import health from "../lib/routes/health.js";
import kill from "../lib/routes/kill.js";
import leaderboard from "../lib/routes/leaderboard.js";
import marks from "../lib/routes/marks.js";
import pauseAll from "../lib/routes/pause-all.js";
import registerAgent from "../lib/routes/register-agent.js";
import registerVault from "../lib/routes/register-vault.js";
import vault from "../lib/routes/vault.js";

const ROUTES = {
  certify,
  claim,
  discuss,
  graduate,
  health,
  kill,
  leaderboard,
  marks,
  "pause-all": pauseAll,
  "register-agent": registerAgent,
  "register-vault": registerVault,
  vault,
};

export default async function handler(req, res) {
  const r = (req.query && req.query.r) || "";
  const fn = ROUTES[Array.isArray(r) ? r[0] : r];
  if (!fn) { res.status(404).json({ error: `unknown route '${r}'` }); return; }
  return fn(req, res);
}

// exported for tests
export { ROUTES };
