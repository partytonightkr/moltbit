// Agent certification — an automated, evidence-based skills check.
//
// Graduating to real capital stays operator-gated, but certification is the
// machine-checkable prerequisite: it inspects an agent's order history + state and
// confirms it has demonstrated the measurable skills (placed real activity, only
// clean fills or policy rejections — no crashes, stayed inside its risk caps).
//
// Pure + deterministic: assessSkills(agent, orders) → scorecard.

export function assessSkills(agent, orders) {
  const a = agent || {};
  const os = Array.isArray(orders) ? orders : [];
  const p = a.policy || {};

  const placed = os.length;
  const filled = os.filter((o) => o.status === "filled").length;
  const policyRejects = os.filter((o) => o.status === "rejected" && o.code).length;
  const execErrors = os.filter((o) => o.status === "error").length;

  const dailyLoss = Math.abs(Number(p.dailyLoss || 0));
  const withinLoss = dailyLoss === 0 ? true : Number(a.dayRealizedPnl || 0) > -dailyLoss;
  const notHalted = a.status !== "halted";

  const checks = [
    {
      skill: "Activity",
      pass: placed >= 5,
      detail: `${placed}/5 order intents submitted`,
    },
    {
      skill: "Policy Compliance",
      pass: filled >= 3 && execErrors === 0,
      detail: `${filled} filled, ${execErrors} execution errors (rejections are fine)`,
    },
    {
      skill: "Risk Discipline",
      pass: withinLoss && notHalted,
      detail: !notHalted ? "currently halted" : withinLoss ? "inside daily-loss cap" : "daily-loss cap breached",
    },
    {
      skill: "Boundary Awareness",
      pass: policyRejects >= 1,
      optional: true, // bonus: shows it probed/handled a limit, not required to certify
      detail: `${policyRejects} policy rejection(s) handled`,
    },
  ];

  const required = checks.filter((c) => !c.optional);
  const certified = required.every((c) => c.pass);
  return {
    certified,
    score: checks.filter((c) => c.pass).length,
    total: checks.length,
    checks,
  };
}
