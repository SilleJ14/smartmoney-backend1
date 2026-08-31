import test from "node:test";
import assert from "node:assert/strict";
import { buildStrategyExecutionPlan, getEnabledStrategyModes, selectSmartTradingMode } from "../strategies/strategyRouter.js";
test("smart scanning enables both asset classes", () => assert.deepEqual(getEnabledStrategyModes("smart"), { stockModeEnabled: true, cryptoModeEnabled: true }));
test("smart mode selects the stronger approved asset class", () => {
  const approval = {
    qualifiedToBuy: true,
    autoTradeApproved: true,
    approved: true,
    backendApproved: true,
  };
  assert.equal(selectSmartTradingMode({
    selectedMode: "smart",
    stockSignals: [{ symbol: "AAPL", masterFinalScore: 80, stockDecisionScoreAvailable: true, ...approval }],
    cryptoSignals: [{ symbol: "BTC/USD", cryptoDecisionScore: 90, cryptoDecisionScoreAvailable: true, ...approval }],
  }), "live_crypto");
});
test("smart mode ignores legacy scores and incomplete approval flags", () => {
  assert.equal(selectSmartTradingMode({
    selectedMode: "smart",
    currentEffectiveMode: "live_crypto",
    stockSignals: [{ symbol: "AAPL", score: 99, qualifiedToBuy: true, autoTradeApproved: true }],
    cryptoSignals: [{ symbol: "BTC/USD", score: 98, qualifiedToBuy: true, autoTradeApproved: true }],
  }), "live_crypto");
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
