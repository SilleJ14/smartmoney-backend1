import test from "node:test";
import assert from "node:assert/strict";
import { parseRemoteConfigUpdates } from "../config/remoteConfigUpdates.js";

test("remote config parses types and enforces score floor", () => {
  const result = parseRemoteConfigUpdates({ minScoreToBuy: "55", maxOpenTrades: "4", enableAdvancedFilters: "true", tradingMode: 7 });
  assert.deepEqual(result.updates, { minScoreToBuy: 70, maxOpenTrades: 4, enableAdvancedFilters: true, tradingMode: "7" });
});

test("remote config rejects invalid numbers and emergency activation", () => {
  assert.match(parseRemoteConfigUpdates({ maxOpenTrades: "bad" }).error, /Invalid number/);
  assert.equal(parseRemoteConfigUpdates({ autoTradingEnabled: true }, true).locked, true);
});

test("remote config cannot re-enable stock trading outside regular hours", () => {
  const result = parseRemoteConfigUpdates({
    allowClosedMarketAutoTrade: true,
    autoTradingEnabled: true,
  });
  assert.deepEqual(result.updates, { autoTradingEnabled: true });
});
