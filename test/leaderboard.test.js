import { test } from "node:test";
import assert from "node:assert/strict";
import { rankAgents } from "../lib/leaderboard.js";

test("ranks by 30d return, then AUM, and assigns ranks", () => {
  const board = rankAgents([
    { id: "a", ret30: 10, aum: 5 },
    { id: "b", ret30: 40, aum: 1 },
    { id: "c", ret30: 10, aum: 9 },
  ]);
  assert.deepEqual(board.map((x) => x.id), ["b", "c", "a"]); // b (40), then c/a tie on 10 → higher AUM c first
  assert.deepEqual(board.map((x) => x.rank), [1, 2, 3]);
});

test("exposes safe fields incl. certified, never the key", () => {
  const board = rankAgents([{ id: "x", name: "X", certified: true, agentKey: "mbk_secret", aum: 3 }]);
  assert.equal(board[0].certified, true);
  assert.equal(board[0].name, "X");
  assert.equal("agentKey" in board[0], false);
});

test("tolerates empty / missing fields", () => {
  assert.deepEqual(rankAgents(null), []);
  const b = rankAgents([{ id: "y" }]);
  assert.equal(b[0].nav, 1);
  assert.equal(b[0].ret30, 0);
});
