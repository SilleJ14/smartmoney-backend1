import test from "node:test";
import assert from "node:assert/strict";
import { calculateInstitutionalBlend } from "../scoring/institutionalBlend.js";

const clampScore = (value) => Math.max(0, Math.min(100, Number(value) || 0));

test("correlated market evidence is represented by one bounded family", () => {
  const result = calculateInstitutionalBlend({ momentum: 20, volumeRatio: 3, technicalScore: 90, statisticalScore: 90, macroScore: 50, sectorScore: 50, blendedRiskScore: 50, portfolioScore: 50, fundamentalDataValid: false }, { clampScore });
  assert.equal(result.componentTelemetry.filter((item) => item.name === "marketEvidence").length, 1);
  assert.ok(result.institutionalScore < 80);
});

test("invalid fundamentals are excluded and remaining weights are normalized", () => {
  const invalid = calculateInstitutionalBlend({ momentum: 0, technicalScore: 60, statisticalScore: 60, macroScore: 60, sectorScore: 60, blendedRiskScore: 60, portfolioScore: 60, fundamentalScore: 100, dcfValuationScore: 100, fundamentalDataValid: false }, { clampScore });
  const neutral = calculateInstitutionalBlend({ momentum: 0, technicalScore: 60, statisticalScore: 60, macroScore: 60, sectorScore: 60, blendedRiskScore: 60, portfolioScore: 60, fundamentalScore: 0, dcfValuationScore: 0, fundamentalDataValid: false }, { clampScore });
  assert.equal(invalid.institutionalScore, neutral.institutionalScore);
  assert.equal(invalid.componentTelemetry.find((item) => item.name === "fundamentals").available, false);
});

test("reinforcement weights change the bounded family blend", () => {
  const input = {
    momentum: 25,
    volumeRatio: 3,
    technicalScore: 95,
    statisticalScore: 95,
    fundamentalScore: 20,
    dcfValuationScore: 20,
    earningsScore: 20,
    moatScore: 20,
    macroScore: 50,
    sectorScore: 50,
    blendedRiskScore: 50,
    portfolioScore: 50,
    fundamentalDataValid: true,
  };
  const marketWeighted = calculateInstitutionalBlend({ ...input, reinforcementWeights: { momentum: 0.5, technicals: 0.5, statisticalEdge: 0.5, fundamentals: 0.02 } }, { clampScore });
  const fundamentalWeighted = calculateInstitutionalBlend({ ...input, reinforcementWeights: { momentum: 0.05, technicals: 0.05, statisticalEdge: 0.05, fundamentals: 0.5 } }, { clampScore });
  assert.notEqual(marketWeighted.institutionalScore, fundamentalWeighted.institutionalScore);
  assert.ok(marketWeighted.institutionalScore > fundamentalWeighted.institutionalScore);
  assert.ok(Math.abs(Object.values(marketWeighted.effectiveGroupWeights).reduce((sum, value) => sum + value, 0) - 1) < 0.00001);
});
