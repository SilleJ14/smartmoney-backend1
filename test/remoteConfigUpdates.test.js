import test from "node:test";
import assert from "node:assert/strict";
import { parseRemoteConfigUpdates } from "../config/remoteConfigUpdates.js";

test("remote config parses valid types without rewriting their values", () => {
  const result = parseRemoteConfigUpdates({ minScoreToBuy: "75", maxOpenTrades: "4", enableAdvancedFilters: "true", tradingMode: 7 });
  assert.deepEqual(result.updates, { minScoreToBuy: 75, maxOpenTrades: 4, enableAdvancedFilters: true, tradingMode: "7" });
});

test("remote config rejects invalid numbers and emergency activation", () => {
  assert.match(parseRemoteConfigUpdates({ maxOpenTrades: "bad" }).error, /Invalid number/);
  assert.match(parseRemoteConfigUpdates({ minScoreToBuy: "55" }).error, /between 70 and 100/);
  assert.equal(parseRemoteConfigUpdates({ autoTradingEnabled: true }, true).locked, true);
});

test("remote config cannot re-enable stock trading outside regular hours", () => {
  const result = parseRemoteConfigUpdates({
    allowClosedMarketAutoTrade: true,
    autoTradingEnabled: true,
  });
  assert.deepEqual(result.updates, { autoTradingEnabled: true });
});
