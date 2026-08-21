import test from "node:test";
import assert from "node:assert/strict";
import { buildMorningStrikeSnapshot } from "../routes/morningStrikeRoutes.js";

test("morning strike snapshot reports remaining daily capacity", () => {
  const result = buildMorningStrikeSnapshot({ morningTradesToday: 3 }, { maxMorningTradesPerDay: 5 }, { isMorningStrikeWindow: true });
  assert.equal(result.morningTradeLimit.remainingMorningTrades, 2);
  assert.equal(result.windows.isMorningStrikeWindow, true);
});
