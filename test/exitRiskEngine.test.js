import test from "node:test";
import assert from "node:assert/strict";
import { calculateCoreExitTriggers, calculateExitParliamentConsensus, calculateTrendPersistenceHoldDecision, calculateTrendQualityHoldDuration } from "../risk/exitRiskEngine.js";
const clamp = (n) => Math.max(0, Math.min(100, Number(n) || 0));
test("extends strong trend holds", () => {
  const result = calculateTrendQualityHoldDuration({ score: 90, technicalScore: 90, statisticalScore: 80, trendPersistenceScore: 90, unrealizedPercent: 5, dropFromHigh: 1 }, clamp);
  assert.equal(result.holdMode, "EXTENDED_SWING_HOLD");
});
test("stop loss always wins parliament", () => {
  const result = calculateExitParliamentConsensus({ symbol: "aapl", shouldStopLoss: true }, { normalizeSymbol: (s) => s.toUpperCase(), clampScore: clamp });
  assert.equal(result.emergencyExit, true);
  assert.equal(result.parliamentMode, "EMERGENCY_EXIT_APPROVED");
});
test("holds strong runners near their high", () => {
  const result = calculateTrendPersistenceHoldDecision({ isRunner: true, unrealizedPercent: 6, dropFromHigh: 1, highWater: 100, currentPrice: 99 });
  assert.equal(result.shouldHold, true);
});
test("hard stops override profitable trailing logic", () => {
  const result = calculateCoreExitTriggers({ unrealizedPercent: -3, dropFromHigh: 5, stopLossPercent: -2 });
  assert.equal(result.shouldStopLoss, true);
  assert.equal(result.shouldNormalTrailingExit, false);
});
