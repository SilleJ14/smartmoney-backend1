import test from "node:test";
import assert from "node:assert/strict";
import { resetDailyLocks } from "../routes/operationalActionRoutes.js";

test("manual daily reset clears every loss and profit lock field", () => {
  const state = { dailyLossLocked: true, profitLocked: true, dailyStartEquity: 100,
    dailyPeakEquity: 120, profitLockFloorEquity: 110, dailyDateKey: "today", untouched: 1 };
  resetDailyLocks(state);
  assert.equal(state.dailyLossLocked, false);
  assert.equal(state.profitLocked, false);
  assert.equal(state.dailyStartEquity, null);
  assert.equal(state.dailyDateKey, null);
  assert.equal(state.untouched, 1);
});
