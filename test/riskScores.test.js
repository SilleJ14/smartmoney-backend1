import test from "node:test";
import assert from "node:assert/strict";
import { calculateInstitutionalRiskScore, calculatePortfolioFitScore } from "../scoring/riskScores.js";
const clampScore = (n) => Math.max(0, Math.min(100, Number(n) || 0));
test("liquid stable stocks score better for portfolio fit", () => {
  const good = calculatePortfolioFitScore({ price: 25, volume: 2_000_000, percentChange: 4, confirmations: { volumeSpikeRatio: 2 }, technicals: { rsi: 60 } }, { clampScore });
  const poor = calculatePortfolioFitScore({ price: 1, volume: 1000, percentChange: 40, confirmations: { fakeBreakout: true }, technicals: { rsi: 90 } }, { clampScore });
  assert.ok(good.portfolioScore > poor.portfolioScore);
});
test("fake breakouts reduce institutional risk quality", () => {
  const safe = calculateInstitutionalRiskScore({ price: 20, volume: 1_000_000, percentChange: 5, confirmations: { aboveVwap: true } }, { clampScore });
  const risky = calculateInstitutionalRiskScore({ price: 2, volume: 1000, percentChange: 45, confirmations: { fakeBreakout: true, newsRisk: true } }, { clampScore });
  assert.ok(safe.institutionalRiskScore > risky.institutionalRiskScore);
});
