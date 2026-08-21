import test from "node:test";
import assert from "node:assert/strict";
import { calculateInstitutionalBlend, evaluateInstitutionalApproval } from "../scoring/institutionalBlend.js";
const clampScore = (n) => Math.max(0, Math.min(100, Number(n) || 0));
test("blends feature families into a bounded score", () => {
  const result = calculateInstitutionalBlend({ momentum: 12, volumeRatio: 2, technicalScore: 90, fundamentalScore: 80, dcfValuationScore: 75, earningsScore: 80, moatScore: 70, dividendScore: 50, harvardDividendScore: 50, macroScore: 80, statisticalScore: 85, blendedRiskScore: 80, portfolioScore: 75, sectorScore: 70 }, { clampScore });
  assert.ok(result.institutionalScore > 0 && result.institutionalScore <= 100);
});
test("approval requires safety, quality, and research", () => {
  const base = { blendedRiskScore: 80, exhaustionRiskScore: 20, volume: 100000, percentChange: 5, maxPercentChange: 100, institutionalScore: 90, minScoreToBuy: 70, institutionalEntryScore: 80, valuationRiskScore: 20, earningsRiskMode: "NORMAL", earningsVolatilityRiskScore: 20, competitiveAdvantageScore: 80, tradingMode: "live_stock", fundamentalDataValid: true };
  assert.equal(evaluateInstitutionalApproval(base).autoTradeApproved, true);
  assert.equal(evaluateInstitutionalApproval({ ...base, fakeBreakout: true }).autoTradeApproved, false);
});
