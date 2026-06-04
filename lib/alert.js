// Ops alerting — one place to page a human when something needs attention:
// reconcile breaks, circuit/daily-loss halts, kill-switch trips, failed crons.
//
// Always logs to stdout/stderr (so it shows in Vercel logs). If ALERT_WEBHOOK_URL
// is set, it also POSTs a Slack-compatible message (Slack/Discord/generic webhooks
// all accept a `{ text }` JSON body). Never throws — alerting must not take down
// the caller it is trying to warn about.

const WEBHOOK = process.env.ALERT_WEBHOOK_URL;

export const ALERT_MODE = WEBHOOK ? "webhook" : "log";

const ICON = { info: "ℹ️", warn: "⚠️", error: "🚨" };

/**
 * Emit an alert. Resolves to a delivery receipt; does not throw.
 * @param {string} event  short machine-ish name, e.g. "reconcile.imbalance"
 * @param {object} detail structured context (agent id, diff, etc.)
 * @param {"info"|"warn"|"error"} level
 */
export async function alert(event, detail = {}, level = "warn") {
  const payload = { service: "moltbit", level, event, detail, ts: new Date().toISOString() };

  // 1. always log — this is the floor, works with zero config
  const line = `[ALERT] ${event} ${JSON.stringify(detail)}`;
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);

  // 2. optional webhook fan-out
  if (!WEBHOOK) return { delivered: false, mode: "log" };
  try {
    const text = `${ICON[level] || "⚠️"} *${event}* (${level})\n\`\`\`${JSON.stringify(detail, null, 2)}\`\`\``;
    const r = await fetch(WEBHOOK, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, ...payload }),
    });
    return { delivered: r.ok, mode: "webhook", status: r.status };
  } catch (e) {
    console.error("[ALERT] webhook delivery failed:", String(e.message || e));
    return { delivered: false, mode: "webhook", error: String(e.message || e) };
  }
}
