// Mark prices for strategies. Serves a real feed when MARK_FEED_URL is set,
// otherwise a deterministic drifting mock so the dashboard + strategies see movement.
// Keyed by market type (perps/spot/options/fx) to match lib/venue.js.

const FEED = process.env.MARK_FEED_URL; // a JSON endpoint returning { perps, spot, ... } or { marks: {...} }
const BASE = { perps: 100, spot: 100, options: 5, fx: 1 };

const round2 = (n) => Math.round(n * 100) / 100;

// Deterministic given `now` — a ±2% oscillation on a 5-minute period (so it's repeatable
// in tests and animated in the dashboard). Replace with a real oracle/quote via MARK_FEED_URL.
export function mockMarks(now = Date.now()) {
  const w = Math.sin(now / 300_000);
  return {
    perps: round2(BASE.perps * (1 + 0.02 * w)),
    spot: round2(BASE.spot * (1 + 0.02 * w)),
    options: round2(BASE.options * (1 + 0.01 * w)),
    fx: BASE.fx,
  };
}

// Pull market marks from an arbitrary feed body. Returns null if nothing usable.
export function normalizeMarks(body) {
  if (!body || typeof body !== "object") return null;
  const src = body.marks && typeof body.marks === "object" ? body.marks : body;
  const m = {};
  for (const k of ["perps", "spot", "options", "fx"]) {
    const v = Number(src[k]);
    if (Number.isFinite(v) && v > 0) m[k] = v;
  }
  return Object.keys(m).length ? m : null;
}

// Live feed if configured (falling back to mock on any failure), else mock.
export async function liveOrMockMarks(now = Date.now()) {
  if (FEED) {
    try {
      const r = await fetch(FEED);
      const body = await r.json();
      const m = normalizeMarks(body);
      if (m) return { marks: { ...mockMarks(now), ...m }, source: "feed" };
    } catch {
      /* fall through to mock */
    }
  }
  return { marks: mockMarks(now), source: "mock" };
}

export const MARKS_SOURCE = FEED ? "feed" : "mock";
