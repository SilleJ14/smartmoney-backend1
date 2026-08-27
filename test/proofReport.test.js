import test from "node:test";
import assert from "node:assert/strict";
import { buildProofReport } from "../analytics/proofReport.js";

test("advanced proof report uses chronological out-of-sample data and includes costs", () => {
  const observations = Array.from({ length: 100 }, (_, index) => ({
    assetClass: "stock", observedAt: index,
    measurements: { 1: { closeReturnPercent: index % 2 ? 2 : -1, peakReturnPercent: index % 2 ? 9 : 1 } },
  }));
  const report = buildProofReport({ observations }, { feePercent: 0.1, slippagePercent: 0.1 });
  assert.equal(report.assets.stock.horizons[1].training.sampleCount, 70);
  assert.equal(report.assets.stock.horizons[1].outOfSample.sampleCount, 30);
  assert.equal(report.assets.stock.horizons[1].outOfSampleReady, true);
  assert.equal(report.assets.stock.horizons[1].all.assumedRoundTripCostPercent, 0.4);
  assert.equal(report.productionClaimApproved, false);
});
