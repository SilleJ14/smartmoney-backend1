import test from "node:test";
import assert from "node:assert/strict";
import {
  PointInTimeReplay,
  applyExecutionShock,
  assertNoSplitLeakage,
  blockBootstrap,
  calibrationAnalysis,
  confidenceBand,
  createSeededRandom,
  cscvPbo,
  deflatedSharpeRatio,
  groupedAnalytics,
  latestVintages,
  monitorDrift,
  monteCarloBlockBootstrap,
  monteCarloTradeOrder,
  performanceAnalytics,
  probabilisticSharpeRatio,
  rollingWalkForwardSplits,
  simulateFill,
  summarizeSimulations,
} from "../forex/research/index.js";
import { applyJournalDriftSafeguards } from "../forex/driftSafeguard.js";
import {
  createApprovalRegistry,
  invalidateChangedStrategyConfig,
  promoteStrategy,
} from "../forex/approvalRegistry.js";

test("point-in-time replay releases candles and macro vintages only when available", () => {
  const replay = new PointInTimeReplay({
    candles: [
      { id: "c1", timestamp: 100, closeTime: 200, close: 1.1 },
      { id: "c2", timestamp: 200, closeTime: 300, close: 1.2 },
    ],
    events: [
      { id: "gdp-v1", seriesId: "GDP", observedAt: 100, availableAt: 250, vintage: 1, value: 2 },
      { id: "gdp-v2", seriesId: "GDP", observedAt: 100, availableAt: 400, vintage: 2, value: 1.8 },
    ],
  });
  assert.deepEqual(replay.advanceTo(199), []);
  assert.deepEqual(replay.advanceTo(200).map((row) => row.id), ["c1"]);
  assert.deepEqual(replay.advanceTo(300).map((row) => row.id), ["gdp-v1", "c2"]);
  assert.equal(replay.snapshot().events[0].value, 2);
  replay.advanceTo(400);
  assert.equal(replay.snapshot().events[0].value, 1.8);
  assert.throws(() => replay.advanceTo(399), /backwards/);
  assert.equal(latestVintages([
    { id: "old", seriesId: "CPI", observedAt: 1, availableAt: 2, value: 3 },
    { id: "future", seriesId: "CPI", observedAt: 1, availableAt: 20, value: 4 },
  ], 10)[0].value, 3);
});

test("fill simulation crosses bid/ask after latency and charges adverse costs and financing", () => {
  const model = applyExecutionShock(
    { spreadMultiplier: 1, slippageBps: 1, latencyMs: 50 },
    { spreadMultiplier: 2, slippageBps: 2, latencyMs: 50 },
  );
  const fill = simulateFill({
    side: "buy",
    units: 100_000,
    submittedAt: 1_000,
    quotes: [
      { at: 1_050, bid: 1.0999, ask: 1.1001 },
      { at: 1_100, bid: 1.1000, ask: 1.1004 },
    ],
    model,
    holdHours: 24,
    longFinancingRate: 0.0365,
  });
  assert.equal(fill.filledAt, 1_100);
  assert.ok(fill.ask - fill.bid > 0.0004);
  assert.ok(fill.price > fill.ask);
  assert.ok(fill.spreadCost > 0);
  assert.ok(fill.slippageCost > 0);
  assert.ok(fill.financing > 10);
  assert.equal(simulateFill({
    side: "sell", units: 1, submittedAt: 5_000, quotes: [{ at: 4_999, bid: 1, ask: 2 }],
  }).filled, false);
});

test("walk-forward splits purge boundaries, apply embargo spacing, and isolate final OOS", () => {
  const result = rollingWalkForwardSplits(40, {
    trainSize: 10,
    testSize: 4,
    step: 4,
    purge: 2,
    embargo: 2,
    finalOosSize: 6,
  });
  assert.deepEqual(result.splits[0].trainIndices, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(result.splits[0].purgeIndices, [10, 11]);
  assert.deepEqual(result.splits[0].testIndices, [12, 13, 14, 15]);
  assert.deepEqual(result.splits[0].embargoIndices, [16, 17]);
  assert.equal(result.splits[1].testIndices[0], 18);
  assert.deepEqual(result.finalOosIndices, [34, 35, 36, 37, 38, 39]);
  assert.equal(assertNoSplitLeakage(result), true);
});

test("seeded trade-order and block-bootstrap Monte Carlo are reproducible", () => {
  const trades = [2, -1, 3, -4, 2, 1];
  const first = monteCarloTradeOrder(trades, { iterations: 20, seed: 42 });
  const second = monteCarloTradeOrder(trades, { iterations: 20, seed: 42 });
  assert.deepEqual(first, second);
  assert.notDeepEqual(first, monteCarloTradeOrder(trades, { iterations: 20, seed: 43 }));
  assert.ok(first.every((row) => row.total === 3));
  const blocks = monteCarloBlockBootstrap(trades, { iterations: 12, seed: 9, blockSize: 2 });
  assert.deepEqual(blocks, monteCarloBlockBootstrap(trades, { iterations: 12, seed: 9, blockSize: 2 }));
  assert.equal(blocks[0].path.length, trades.length);
  const direct = blockBootstrap(trades, { blockSize: 3, random: createSeededRandom(7) });
  assert.equal(direct.length, trades.length);
  const summary = summarizeSimulations(blocks);
  assert.ok(Number.isFinite(summary.drawdownP95));
  assert.ok(summary.lossProbability >= 0 && summary.lossProbability <= 1);
});

test("performance and grouped analytics report trading statistics", () => {
  const trades = [
    { pnl: 100, return: 0.01, risk: 50, strategy: "trend", regime: "risk-on", session: "London", pair: "EUR_USD" },
    { pnl: -50, return: -0.005, risk: 50, strategy: "trend", regime: "risk-off", session: "NY", pair: "EUR_USD" },
    { pnl: 150, return: 0.015, risk: 100, strategy: "mean", regime: "risk-on", session: "London", pair: "GBP_USD" },
  ];
  const metrics = performanceAnalytics(trades);
  assert.equal(metrics.expectancy, 200 / 3);
  assert.equal(metrics.maxDrawdown, 50);
  assert.equal(metrics.profitFactor, 5);
  assert.equal(metrics.winRate, 2 / 3);
  assert.equal(metrics.averageR, (2 - 1 + 1.5) / 3);
  assert.ok(metrics.sharpe > 0);
  assert.ok(metrics.sortino > 0);
  const groups = groupedAnalytics(trades);
  assert.equal(groups.strategy.trend.count, 2);
  assert.equal(groups.regime["risk-on"].netProfit, 250);
  assert.equal(groups.session.London.count, 2);
  assert.equal(groups.pair.EUR_USD.count, 2);
});

test("calibration computes bins, Brier score, and Murphy decomposition", () => {
  const result = calibrationAnalysis([
    { probability: 0.1, outcome: 0 },
    { probability: 0.2, outcome: 0 },
    { probability: 0.8, outcome: 1 },
    { probability: 0.9, outcome: 1 },
  ], { binCount: 2 });
  assert.ok(Math.abs(result.brierScore - 0.025) < 1e-12);
  assert.equal(result.bins[0].count, 2);
  assert.equal(result.bins[1].observedFrequency, 1);
  assert.ok(Math.abs(result.brierScore - result.decomposedBrier - result.binningResidual) < 1e-12);
  assert.throws(() => calibrationAnalysis([{ probability: 1.2, outcome: 1 }]), /Probabilities/);
});

test("PSR, deflated Sharpe, and CSCV PBO diagnostics are deterministic", () => {
  const returns = [0.02, 0.01, 0.015, -0.002, 0.012, 0.018, 0.007, 0.011];
  const psr = probabilisticSharpeRatio(returns);
  const deflated = deflatedSharpeRatio(returns, { trials: 20 });
  assert.ok(psr > 0.9);
  assert.ok(deflated.probability < psr);
  const matrix = {
    stable: [1, 1, 1, 1, 1, 1, 1, 1],
    early: [4, 4, 4, 4, -4, -4, -4, -4],
    late: [-3, -3, -3, -3, 3, 3, 3, 3],
  };
  const pbo = cscvPbo(matrix, { partitions: 4 });
  assert.equal(pbo.combinations, 6);
  assert.ok(pbo.pbo >= 0 && pbo.pbo <= 1);
  assert.deepEqual(pbo, cscvPbo(matrix, { partitions: 4 }));
});

test("drift monitoring can pause but never auto-retunes", () => {
  const bands = {
    expectancy: confidenceBand([8, 9, 10, 11, 12]),
    cost: { lower: 1, upper: 2 },
    calibration: { lower: 0.05, upper: 0.15 },
    drawdown: { lower: 5, upper: 20 },
  };
  const healthy = monitorDrift({
    current: { expectancy: 10, cost: 1.5, calibration: 0.1, drawdown: 10 },
    confidenceBands: bands,
  });
  assert.equal(healthy.action, "CONTINUE");
  assert.equal(healthy.autoRetune, false);
  const breached = monitorDrift({
    current: { expectancy: 1, cost: 3, calibration: 0.3, drawdown: 25 },
    confidenceBands: bands,
  });
  assert.equal(breached.action, "PAUSE");
  assert.deepEqual(breached.breaches.map((row) => row.reason),
    ["EXPECTANCY", "COST", "CALIBRATION", "DRAWDOWN"]);
  assert.equal(breached.autoRetune, false);
  assert.ok(!JSON.stringify(breached).includes("RETUNE"));
});

test("validated registry promotion requires full OOS evidence and live drift only pauses", () => {
  const registry = createApprovalRegistry();
  const strategyId = "FOREX_BREAKOUT_RETEST_V1";
  const report = {
    completedTrades: 250,
    months: 18,
    forwardPractice: true,
    expectancyLowerBound: 0.05,
    drawdownAcceptable: true,
    survivedAdverseCosts: true,
    independentOfOtherStrategy: true,
    walkForwardPassed: true,
    untouchedOutOfSamplePassed: true,
    probabilityBacktestOverfit: 0.1,
    deflatedSharpeProbability: 0.97,
    brierScore: 0.18,
    calibrationPassed: true,
    featureSnapshotVersion: 1,
    configHash: "validated-config",
    environmentRequested: "FORWARD_PRACTICE",
  };
  assert.equal(promoteStrategy(registry, strategyId, report).environment, "FORWARD_PRACTICE");
  registry[strategyId].validatedConfidenceBands = {
    expectancy: { lower: 0.1, upper: 1 },
    cost: { lower: 0, upper: 0.2 },
    calibration: { lower: 0, upper: 0.25 },
    drawdown: { lower: 0, upper: 5 },
  };
  const outcomes = Array.from({ length: 20 }, (_, index) => ({
    payload: {
      strategyId,
      rMultiple: -0.5,
      costR: 0.3,
      predictedProbability: 0.8,
      success: false,
      resolvedAt: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
    },
  }));
  const reviews = applyJournalDriftSafeguards({
    registry,
    journal: { listEvents: () => outcomes },
    now: Date.parse("2026-10-02T00:00:00Z"),
  });
  assert.equal(reviews[0].action, "PAUSE");
  assert.equal(registry[strategyId].disabled, true);
  assert.equal(registry[strategyId].configHash, "validated-config");

  const changed = invalidateChangedStrategyConfig(registry, strategyId, "changed-config");
  assert.equal(changed.invalidated, true);
  assert.equal(registry[strategyId].permittedEnvironment, "RESEARCH");
});
