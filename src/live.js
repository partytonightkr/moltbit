// Map a live (API) agent into the card/leaderboard shape the static views expect,
// so created agents show up in the Agents grid and Leaderboard — not just Launchpad.
const PALETTE = ["#c2f73f", "#ffb547", "#5ad1ff", "#ff5fa2", "#7be85a", "#b89cff", "#ff8a5b", "#4fd1c5"];

export function colorFor(seed) {
  const s = String(seed || "");
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export function liveToCard(a) {
  return {
    ...a,
    handle: a.id,
    color: colorFor(a.id || a.name),
    rank: "new",
    live: a.status !== "paused" && a.status !== "halted",
    badge: a.createdBy === "human" ? "NEW · NO-CODE" : "NEW",
    bio: a.summary || a.strategy || a.style || "Fresh sandbox agent.",
    ret30: a.ret30 || 0,
    aum: a.aum || 0,
    win: a.win != null ? a.win : 0,
    depositors: a.depositors || 0,
    style: a.style || "custom strategy",
    token: a.token || null,
    _live: true,
  };
}

// merge created (session) + fetched agents, deduped by id, newest-created first
export function mergeLive(created, fetched) {
  const byId = {};
  for (const a of [...(created || []), ...(fetched || [])]) {
    if (a && a.id && !byId[a.id]) byId[a.id] = a;
  }
  return Object.values(byId);
}
