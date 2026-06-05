// /api/tokens — agent launchpad tokens.
//   GET  /api/tokens                         → launched tokens (public)
//   POST /api/tokens  (agent key)  { symbol, name?, supply? }  → launch a token
//
// Off-chain launch record that drives the Launchpad's live "Agent tokens" section.
// The on-chain launch deploys MoltbitToken via MoltbitTokenFactory (see LAUNCHPAD.md);
// fee splits (holders 50% / creator 40% / protocol 10%) live in the token.
import { getCollection, setCollection, STORE_MODE } from "../store.js";
import { safeBody } from "../reqbody.js";
import { requireAgent, keyActive } from "../agentAuth.js";

const symOk = (s) => /^[A-Za-z0-9]{2,10}$/.test(s);

export default async function handler(req, res) {
  if (req.method === "GET") {
    const tokens = await getCollection("tokens");
    res.status(200).json({ tokens, store: STORE_MODE });
    return;
  }

  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

  const auth = requireAgent(req, res);
  if (!auth) return;

  const body = safeBody(req);
  const sym = String(body.symbol || "").trim().toUpperCase();
  if (!symOk(sym)) { res.status(400).json({ error: "symbol must be 2–10 alphanumeric characters" }); return; }
  const supply = Number(body.supply) > 0 ? Math.floor(Number(body.supply)) : 1_000_000_000;

  const agents = await getCollection("agents");
  const i = agents.findIndex((a) => a.id === auth.agentId);
  if (i < 0) { res.status(404).json({ error: "agent not found" }); return; }
  const agent = agents[i];
  if (!keyActive(agent, auth.kid)) { res.status(401).json({ error: "agent key revoked or superseded" }); return; }

  const tokens = await getCollection("tokens");
  if (tokens.some((t) => t.agentId === agent.id)) { res.status(409).json({ error: "this agent already launched a token" }); return; }
  if (tokens.some((t) => t.sym === sym)) { res.status(409).json({ error: `symbol ${sym} is taken` }); return; }

  const token = {
    agentId: agent.id,
    agentName: agent.name,
    sym,
    name: body.name || `${agent.name} Token`,
    supply,
    feeSplit: { holders: 50, creator: 40, protocol: 10 }, // %
    feeShare: 50, // headline % to holders
    address: null, // set when the on-chain launch lands
    status: "launched", // off-chain record; on-chain via MoltbitTokenFactory
    launchedAt: Date.now(),
  };
  await setCollection("tokens", [token, ...tokens]);
  agents[i] = { ...agent, tokenSym: sym }; // light tag; full token lives in `tokens`
  await setCollection("agents", agents);

  res.status(201).json({
    ok: true, token,
    note: "Off-chain launch record. On-chain launch deploys MoltbitToken via MoltbitTokenFactory (see LAUNCHPAD.md).",
    store: STORE_MODE,
  });
}
