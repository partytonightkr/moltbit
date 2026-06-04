import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAgentKey, fmtUsd, decideTick, renderDashboard, buildContext } from "../agent-cli/lib.mjs";

test("parseAgentKey extracts env/id/version", () => {
  const p = parseAgentKey("mbk_test_aurora-carry-2ios.0." + "a".repeat(48));
  assert.equal(p.env, "test");
  assert.equal(p.agentId, "aurora-carry-2ios");
  assert.equal(p.keyVersion, 0);
  assert.equal(parseAgentKey("not-a-key"), null);
});

test("fmtUsd formats positive and negative", () => {
  assert.equal(fmtUsd(1234.5), "$1,234.50");
  assert.equal(fmtUsd(-12.5), "-$12.50");
  assert.equal(fmtUsd(0), "$0.00");
});

test("decideTick normalizes a valid intent and survives a throwing strategy", () => {
  const ok = decideTick(() => ({ market: "perps", side: "long", notional: 1000, leverage: 3 }), {});
  assert.equal(ok.intent.market, "perps");
  assert.equal(ok.intent.side, "long");

  const none = decideTick(() => null, {});
  assert.equal(none.intent, null);

  const bad = decideTick(() => ({ market: "perps", notional: 0 }), {});
  assert.equal(bad.intent, null);
  assert.ok(bad.error);

  const boom = decideTick(() => { throw new Error("kaboom"); }, {});
  assert.equal(boom.intent, null);
  assert.match(boom.error, /kaboom/);
});

test("decideTick defaults side to long and leverage to 1", () => {
  const r = decideTick(() => ({ market: "spot", notional: 500 }), {});
  assert.equal(r.intent.side, "long");
  assert.equal(r.intent.leverage, 1);
});

test("buildContext shapes the strategy input", () => {
  const ctx = buildContext({
    agent: { status: "sandbox", nav: 1.05, aum: 12000, deployed: 2000, dayRealizedPnl: -50, policy: { maxLeverage: 4 } },
    orders: [{ id: "1" }, { id: "2" }],
    tick: 7, marks: { perps: 100 },
  });
  assert.equal(ctx.tick, 7);
  assert.equal(ctx.status, "sandbox");
  assert.equal(ctx.nav, 1.05);
  assert.equal(ctx.policy.maxLeverage, 4);
  assert.equal(ctx.marks.perps, 100);
  assert.equal(ctx.lastFills.length, 2);
});

test("renderDashboard produces a bordered panel with the key data points", () => {
  const out = renderDashboard({
    host: "https://x", env: "test", agentId: "bot-1", name: "Bot", status: "sandbox",
    nav: 1.0423, aum: 12340, deployed: 3200, dayRealizedPnl: -12.5,
    policy: { maxLeverage: 4, maxPosition: 8000, dailyLoss: 1500, treasuryCap: 15, markets: { perps: true, spot: true } },
    fills: [{ ts: Date.now(), side: "long", market: "perps", notional: 5000, leverage: 3, status: "filled" }],
    tick: 42, intervalSec: 5, strategyName: "carry.mjs",
  });
  assert.match(out, /MOLTBIT - Bot \[sandbox\]/);
  assert.match(out, /NAV 1\.0423/);
  assert.match(out, /AUM \$12,340/);
  assert.match(out, /lev<=4x/);
  assert.match(out, /recent intents/);
  assert.match(out, /carry\.mjs/);
  assert.ok(out.startsWith("┌"));
});

test("renderDashboard flags a halted agent", () => {
  const out = renderDashboard({ host: "h", env: "test", agentId: "b", name: "B", status: "halted", policy: {}, fills: [] });
  assert.match(out, /HALTED/);
});
