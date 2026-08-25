import test from "node:test";
import assert from "node:assert/strict";
import {
  addUsStockMarketSessionDays,
  isUsStockMarketSessionDayKey,
} from "../utils/usMarketCalendar.js";

test("US stock calendar excludes weekends and observed exchange holidays", () => {
  assert.equal(isUsStockMarketSessionDayKey("2026-08-21"), true);
  assert.equal(isUsStockMarketSessionDayKey("2026-08-22"), false);
  assert.equal(isUsStockMarketSessionDayKey("2026-07-03"), false);
  assert.equal(isUsStockMarketSessionDayKey("2026-11-26"), false);
  assert.equal(isUsStockMarketSessionDayKey("2026-04-03"), false);
});

test("market-session addition skips weekends and holidays", () => {
  assert.deepEqual(
    addUsStockMarketSessionDays({ year: 2026, month: 7, day: 2 }, 1),
    { year: 2026, month: 7, day: 6 }
  );
});
