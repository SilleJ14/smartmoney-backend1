import test from "node:test";
import assert from "node:assert/strict";
import { buildStrategyExecutionPlan, getEnabledStrategyModes, selectSmartTradingMode } from "../strategies/strategyRouter.js";
test("smart scanning enables both asset classes", () => assert.deepEqual(getEnabledStrategyModes("smart"), { stockModeEnabled: true, cryptoModeEnabled: true }));
test("smart mode selects the stronger approved asset class", () => {
  assert.equal(selectSmartTradingMode({ selectedMode: "smart", stockSignals: [{ score: 80, qualifiedToBuy: true, autoTradeApproved: true }], cryptoSignals: [{ score: 90, qualifiedToBuy: true }] }), "live_crypto");
});
test("stock execution requires an open market", () => {
  const plan = buildStrategyExecutionPlan({ selectedMode: "smart", effectiveMode: "live_stock", marketOpen: false, approvedStockCount: 2, approvedCryptoCount: 0 });
  assert.equal(plan.shouldRunStockAutoBuy, false);
});
test("crypto execution remains eligible when the stock market is closed", () => {
  const plan = buildStrategyExecutionPlan({
    selectedMode: "smart",
    effectiveMode: "live_crypto",
    marketOpen: false,
    approvedStockCount: 2,
    approvedCryptoCount: 1,
    tradingStoppedForDay: true,
    stockTradingStoppedForDay: true,
    cryptoTradingStoppedForDay: false,
  });
  assert.equal(plan.shouldRunStockAutoBuy, false);
  assert.equal(plan.shouldRunCryptoAutoBuy, true);
});
