import test from "node:test";
import assert from "node:assert/strict";
import { canonicalizeEngineStateAliases } from "../state/canonicalizeEngineState.js";

const approval = {
  qualifiedToBuy: true,
  autoTradeApproved: true,
  approved: true,
  backendApproved: true,
};

test("persisted top-signal aliases rank explicit approval and canonical F", () => {
  const state = {
    lastStockSignals: [
      { symbol: "LEGACY", score: 100 },
      {
        symbol: "AAPL",
        score: 10,
        masterFinalScore: 81,
        stockDecisionScoreAvailable: true,
        ...approval,
      },
    ],
    lastCryptoSignals: [
      {
        symbol: "BTC/USD",
        score: 5,
        cryptoDecisionScore: 85,
        cryptoDecisionScoreAvailable: true,
        ...approval,
      },
      { symbol: "ETH/USD", score: 99 },
    ],
  };

  canonicalizeEngineStateAliases(state, { maxSignalsToReturn: 75 });

  assert.equal(state.topStockSignals[0].symbol, "AAPL");
  assert.equal(state.topCryptoSignals[0].symbol, "BTC/USD");
  assert.deepEqual(state.topSignals.slice(0, 2).map((item) => item.symbol), [
    "BTC/USD",
    "AAPL",
  ]);
});
