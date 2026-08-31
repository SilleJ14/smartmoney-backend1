import test from "node:test";
import assert from "node:assert/strict";
import {
  recordTradingModeWithoutResettingSafety,
  resetDailySafetyState,
} from "../state/dailySafetyState.js";

test("resets daily safety locks on a new trading day", () => {
  const state = {
    dailyDateKey: "2026-08-20",
    dailyLossLocked: true,
    profitLocked: true,
    profitLockFloorEquity: 1010,
  };
  const result = resetDailySafetyState(state, { todayKey: "2026-08-21", equity: 1000 });
  assert.equal(result.reset, true);
  assert.deepEqual(state, {
    dailyDateKey: "2026-08-21",
    dailyStartEquity: 1000,
    dailyPeakEquity: 1000,
    profitLockFloorEquity: null,
    dailyLossLocked: false,
    profitLocked: false,
  });
});

test("does not reset without valid equity or a date change", () => {
  const state = { dailyDateKey: "2026-08-21" };
  assert.equal(resetDailySafetyState(state, { todayKey: "2026-08-21", equity: 1000 }).reset, false);
  assert.equal(resetDailySafetyState(state, { todayKey: "2026-08-22", equity: 0 }).reset, false);
});

test("trading mode changes never clear same-day safety locks or baselines", () => {
  const state = {
    lastMode: "live_stock",
    dailyDateKey: "2026-08-31",
    dailyStartEquity: 10000,
    dailyPeakEquity: 10400,
    profitLockFloorEquity: 10200,
    dailyLossLocked: true,
    profitLocked: true,
  };
  const result = recordTradingModeWithoutResettingSafety(state, "smart");
  assert.equal(result.changed, true);
  assert.equal(state.lastMode, "smart");
  assert.equal(state.dailyStartEquity, 10000);
  assert.equal(state.dailyPeakEquity, 10400);
  assert.equal(state.profitLockFloorEquity, 10200);
  assert.equal(state.dailyLossLocked, true);
  assert.equal(state.profitLocked, true);
});
