import test from "node:test";
import assert from "node:assert/strict";
import { buildProofReport } from "../analytics/proofReport.js";

test("advanced proof report uses chronological out-of-sample data and includes costs", () => {
  const observations = Array.from({ length: 101 }, (_, index) => ({
    assetClass: "stock", symbol: `S${index}`, observedAt: Date.UTC(2025, 0, 1) + index * 86400000,
    measurements: { 1: { closeReturnPercent: index % 2 ? 2 : -1, peakReturnPercent: index % 2 ? 9 : 1 } },
  }));
  const report = buildProofReport({ observations }, { feePercent: 0.1, slippagePercent: 0.1 });
  assert.equal(report.assets.stock.horizons[1].training.sampleCount, 70);
  assert.equal(report.assets.stock.horizons[1].outOfSample.sampleCount, 30);
  assert.equal(report.assets.stock.horizons[1].outOfSampleReady, true);
  assert.equal(report.assets.stock.horizons[1].all.assumedRoundTripCostPercent, 0.4);
  assert.equal(report.productionClaimApproved, false);
});

test("walk-forward cutoff stays fixed as new future samples arrive and benchmarks stay matched", () => {
  const startedAt = Date.UTC(2025, 0, 1);
  const makeObservation = (index) => ({
    assetClass: "stock",
    symbol: `S${index}`,
    observedAt: startedAt + index * 86400000,
    measurements: { 1: { closeReturnPercent: 2, peakReturnPercent: 9 } },
    benchmarkMeasurements: { 1: { SPY: 1 } },
  });
  const first = buildProofReport({ observations: Array.from({ length: 101 }, (_, index) => makeObservation(index)) });
  const expanded = buildProofReport({ observations: Array.from({ length: 111 }, (_, index) => makeObservation(index)) });
  assert.equal(
    first.assets.stock.horizons[1].trainingCutoffAt,
    expanded.assets.stock.horizons[1].trainingCutoffAt
  );
  assert.equal(first.assets.stock.horizons[1].outOfSample.sampleCount, 30);
  assert.equal(expanded.assets.stock.horizons[1].outOfSample.sampleCount, 40);
  assert.equal(first.assets.stock.horizons[1].matchedBenchmarks.SPY.sampleCount, 30);
  assert.ok(first.assets.stock.horizons[1].matchedBenchmarks.SPY.averageExcessReturnPercent > 0);
});

test("production proof requires positive confidence, matched benchmarks, bounded drawdown, and one model version", () => {
  const startedAt = Date.UTC(2025, 0, 1);
  const observations = ["stock", "crypto"].flatMap((assetClass) =>
    Array.from({ length: 111 }, (_, index) => ({
      assetClass,
      symbol: `${assetClass}-${index}`,
      observedAt: startedAt + index * 86400000,
      scoringModelVersion: assetClass === "stock"
        ? "SMARTMONEY_STOCK_DECISION_V3"
        : "SMARTMONEY_CRYPTO_DECISION_V3",
      measurements: Object.fromEntries([1, 3, 5].map((days) => [days, {
        closeReturnPercent: 4,
        peakReturnPercent: 12,
      }])),
      benchmarkMeasurements: Object.fromEntries([1, 3, 5].map((days) => [days, {
        SPY: 1,
        Bitcoin: 1,
        simpleMomentum: 0.5,
      }])),
    }))
  );
  const report = buildProofReport({ observations });
  assert.equal(report.productionClaimApproved, true);
  assert.equal(report.assets.stock.horizons[5].productionReadiness.approved, true);
  assert.equal(report.assets.crypto.horizons[5].productionReadiness.approved, true);
});

test("large negative out-of-sample returns can never pass a production claim", () => {
  const startedAt = Date.UTC(2025, 0, 1);
  const observations = ["stock", "crypto"].flatMap((assetClass) =>
    Array.from({ length: 111 }, (_, index) => ({
      assetClass,
      symbol: `${assetClass}-${index}`,
      observedAt: startedAt + index * 86400000,
      scoringModelVersion: `${assetClass}-v3`,
      measurements: Object.fromEntries([1, 3, 5].map((days) => [days, {
        closeReturnPercent: -10,
        peakReturnPercent: 0,
      }])),
      benchmarkMeasurements: Object.fromEntries([1, 3, 5].map((days) => [days, {
        SPY: 0,
        Bitcoin: 0,
        simpleMomentum: 0,
      }])),
    }))
  );
  const report = buildProofReport({ observations });
  assert.equal(report.productionClaimApproved, false);
  assert.equal(report.assets.stock.horizons[1].productionReadiness.checks.positiveNetReturn, false);
});

test("missed target windows never count as zero-return proof samples", () => {
  const report = buildProofReport({ observations: [{
    assetClass: "stock",
    symbol: "MISS",
    observedAt: Date.UTC(2026, 0, 1),
    measurements: { 1: {
      status: "MISSED_TARGET_WINDOW",
      closeReturnPercent: null,
      peakReturnPercent: null,
    } },
  }] });
  assert.equal(report.assets.stock.horizons[1].all.sampleCount, 0);
});
