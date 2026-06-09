import { test } from "node:test";
import assert from "node:assert/strict";
import { recordHeartbeat, isUp, uptimeStats, EXPECTED_INTERVAL_MS } from "../lib/uptime.js";

const MIN = 60_000;
const DAY = 86_400_000;

test("recordHeartbeat sets first/last seen and logs a long gap as an outage", () => {
  const t0 = 1_000_000_000;
  let a = { ...recordHeartbeat({}, t0) };
  assert.equal(a.firstSeenAt, t0);
  assert.equal(a.lastSeenAt, t0);
  assert.equal(a.outages.length, 0);

  // a heartbeat 5 min later — within interval, no outage
  a = { ...a, ...recordHeartbeat(a, t0 + 5 * MIN) };
  assert.equal(a.outages.length, 0);

  // a heartbeat 1 hour later — gap > 20m ⇒ outage logged
  a = { ...a, ...recordHeartbeat(a, t0 + 5 * MIN + 60 * MIN) };
  assert.equal(a.outages.length, 1);
  assert.equal(a.outages[0].ms, 60 * MIN);
});

test("isUp reflects recency", () => {
  const now = Date.now();
  assert.equal(isUp({ lastSeenAt: now - 2 * MIN }, now), true);
  assert.equal(isUp({ lastSeenAt: now - (EXPECTED_INTERVAL_MS + MIN) }, now), false);
  assert.equal(isUp({}, now), false);
});

test("uptimeStats: perfect uptime when always seen; degrades with outages", () => {
  const now = Date.now();
  const perfect = { firstSeenAt: now - 2 * DAY, lastSeenAt: now - MIN, outages: [] };
  const p = uptimeStats(perfect, DAY, now);
  assert.equal(p.tracked, true);
  assert.equal(p.up, true);
  assert.ok(p.uptimePct > 99.5);

  // a 6h outage inside the last 24h → ~75%
  const withOutage = { firstSeenAt: now - 2 * DAY, lastSeenAt: now - MIN, outages: [{ from: now - 12 * 3600_000, to: now - 6 * 3600_000, ms: 6 * 3600_000 }] };
  const w = uptimeStats(withOutage, DAY, now);
  assert.ok(w.uptimePct > 70 && w.uptimePct < 80);
  assert.equal(w.outages, 1);
});

test("uptimeStats: currently-down agent counts the open gap", () => {
  const now = Date.now();
  const down = { firstSeenAt: now - DAY, lastSeenAt: now - 6 * 3600_000, outages: [] };
  const s = uptimeStats(down, DAY, now);
  assert.equal(s.up, false);
  assert.ok(s.uptimePct < 80); // ~6h of the last 24h down
});

test("untracked agent reports no data", () => {
  const s = uptimeStats({}, DAY);
  assert.equal(s.tracked, false);
  assert.equal(s.uptimePct, null);
});
