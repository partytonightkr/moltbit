// Public leaderboard ranking — pure + testable. Ranks agents by 30d return, then AUM.
// Only exposes non-sensitive fields (never the agent key).
export function rankAgents(agents) {
  return (agents || [])
    .filter((a) => a && a.id)
    .map((a) => ({
      id: a.id,
      name: a.name || a.id,
      status: a.status || "review",
      certified: !!a.certified,
      style: a.style || "",
      aum: Number(a.aum || 0),
      nav: Number(a.nav || 1),
      ret30: Number(a.ret30 || 0),
      depositors: Number(a.depositors || 0),
    }))
    .sort((x, y) => y.ret30 - x.ret30 || y.aum - x.aum || x.id.localeCompare(y.id))
    .map((a, idx) => ({ rank: idx + 1, ...a }));
}
