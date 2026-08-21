import test from "node:test";
import assert from "node:assert/strict";
import { calculateCryptoStrategySelection } from "../strategies/cryptoStrategySelector.js";

const dependencies = {
  normalizeSymbol: (symbol) => String(symbol).toUpperCase(),
  clampScore: (score) => Math.max(0, Math.min(100, Number(score))),
  now: () => new Date("2026-08-21T12:00:00.000Z"),
};

test("selects whale accumulation for accumulation-dominant crypto", () => {
  const result = calculateCryptoStrategySelection([{
    symbol: "btc/usd", score: 70, liquidityScore: 85, whaleScore: 100,
    stablecoinFlowScore: 100, multiTimeframeScore: 90, executionTimingScore: 70,
    positionSizingScore: 60, exitRiskScore: 10,
  }], dependencies);
  assert.equal(result.selectedCryptoSignals[0].selectedStrategy, "WHALE_ACCUMULATION_FOLLOW_THROUGH");
  assert.equal(result.deployableStrategyCount, 1);
});

test("blocks weak crypto strategy candidates", () => {
  const result = calculateCryptoStrategySelection([{ symbol: "ETH/USD", score: 10,
    liquidityScore: 10, whaleScore: 10, stablecoinFlowScore: 10,
    multiTimeframeScore: 10, executionTimingScore: 10, positionSizingScore: 10,
    exitRiskScore: 100 }], dependencies);
  assert.equal(result.selectedCryptoSignals[0].action, "BLOCK_WEAK_CRYPTO_STRATEGY");
  assert.equal(result.deployableStrategyCount, 0);
});
