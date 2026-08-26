import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateCryptoLiquidityFromBars,
  calculateCryptoSignalRealism,
  getCryptoBaseAsset,
} from "../scoring/cryptoScoring.js";
import {
  CRYPTO_DECISION_WEIGHTS,
  buildCryptoDecisionScore,
  calculateAvailableWeightedScore,
  evaluateCryptoTradeCandidate,
} from "../scoring/componentScore.js";
import { createCryptoMarketScanner } from "../strategies/cryptoMarketScanner.js";
import { createCryptoIntelligenceStrategy } from "../strategies/cryptoIntelligenceStrategy.js";

const clampScore = (value) => Math.max(0, Math.min(100, Number(value) || 0));

function createScanner() {
  return createCryptoMarketScanner({
    CONFIG: { minScoreToBuy: 70 },
    calculateCryptoLiquidityFromBars,
    calculateRunnerHoldQuality: () => ({ runnerHoldApproved: true, runnerHoldScore: 80 }),
    calculateRunnerStageProfile: () => ({ runnerStage: "EARLY", lateChaseRisk: false }),
    clampScore,
    engineState: {
      selfOptimizationState: { adaptiveMinScoreToBuy: 70 },
      marketCycleIntelligenceState: {},
      autonomousTradingSystemState: {},
      phase21AutonomousBrainState: {},
      macroRiskState: {},
      marketCrashProtectionState: {},
    },
    getRuntime: () => ({ TRADING_MODE: "smart", LIVE_ORDER_MAX_QUOTE_AGE_SECONDS: 8 }),
  });
}

test("sparse crypto bars produce a neutral normalized score instead of raw percent change", () => {
  const { scoreCrypto } = createScanner();
  const score = scoreCrypto(
    { current: 100, changePercent: 1.2 },
    [{ o: 99, h: 100, l: 99, c: 99.5, v: 10 }, { o: 99.5, h: 101, l: 99.5, c: 100, v: 10 }]
  );

  assert.ok(score >= 50 && score < 65);
  assert.notEqual(score, 1.2);
  assert.ok(scoreCrypto({}, [{ c: 100, v: 1 }]) >= 50);
  assert.equal(scoreCrypto({ current: 0, changePercent: 3 }, []), 0);
});

test("quiet liquid major crypto keeps its score and reports missing statistics as unavailable", () => {
  const signal = {
    symbol: "BTC/USD",
    cryptoDiscoveryScorecard: {
      stage: "CRYPTO_EARLY_DISCOVERY",
      score: 82,
      coverage: 1,
      calculatedAt: new Date().toISOString(),
      extension: { alreadyExtended: false },
    },
    newsCatalyst: { dataAvailable: true, riskDetected: false },
    score: 12,
    current: 100,
    bid: 99.95,
    ask: 100,
    spreadAvailable: true,
    barsFound: 30,
    windowDollarVolume: 1_000_000_000,
    percentChange: 0.1,
  };
  const result = calculateCryptoSignalRealism(signal);

  assert.equal(result.rawScore, 82);
  assert.equal(result.realismScore, 82);
  assert.ok(result.entryQualityScore >= 80);
  assert.equal(result.quietMarketPenalty, 0);
  assert.equal(result.missingStatisticalPenalty, 0);
  assert.ok(result.missingComponents.includes("statisticalEdge"));
  assert.equal(signal.score, 12, "pure scoring must not overwrite the caller's score");
});

test("crypto liquidity uses reported 24-hour volume or the full bar window, not only the latest bar", () => {
  const bars = Array.from({ length: 30 }, (_, index) => ({
    c: 100,
    v: index === 29 ? 0.01 : 10,
  }));
  const windowMetrics = calculateCryptoLiquidityFromBars(bars, 100);
  const reportedMetrics = calculateCryptoLiquidityFromBars(bars, 100, {
    dollarVolume24h: 2_000_000,
  });
  const explicitLowMetrics = calculateCryptoLiquidityFromBars(bars, 100, {
    dollarVolume24h: 5_000,
  });

  assert.ok(windowMetrics.windowDollarVolume >= 29_000);
  assert.equal(windowMetrics.liquiditySource, "aggregated_bar_window");
  assert.equal(windowMetrics.liquidityPass, true);
  assert.equal(reportedMetrics.dollarVolume, 2_000_000);
  assert.equal(reportedMetrics.liquiditySource, "reported_24h");
  assert.equal(explicitLowMetrics.dollarVolume, 5_000);
  assert.equal(explicitLowMetrics.liquidityPass, false);
});

test("crypto liquidity applies source-aware thresholds", () => {
  const bars = Array.from({ length: 30 }, () => ({ c: 100, v: 10 }));
  const windowMetrics = calculateCryptoLiquidityFromBars(bars, 100);
  const thinDailyMetrics = calculateCryptoLiquidityFromBars(bars, 100, {
    dollarVolume24h: 25_000,
  });

  assert.equal(windowMetrics.liquiditySource, "aggregated_bar_window");
  assert.equal(windowMetrics.liquidityPass, true);
  assert.equal(thinDailyMetrics.liquiditySource, "reported_24h");
  assert.equal(thinDailyMetrics.liquidityMinimumDollarVolume, 1_000_000);
  assert.equal(thinDailyMetrics.liquidityPass, false);

  const { calculateCryptoInstitutionalQualification } = createScanner();
  const thinDailyQualification = calculateCryptoInstitutionalQualification({
    quote: { current: 100 },
    score: 90,
    bars,
    liquidityMetrics: thinDailyMetrics,
    spreadAvailable: true,
    spreadPercent: 0.1,
  });
  assert.equal(thinDailyQualification.qualifiedToBuy, false);
  assert.equal(
    thinDailyQualification.cryptoInstitutionalQualification.liquidityPass,
    false
  );

  const explicitZeroRealism = calculateCryptoSignalRealism({
    symbol: "BTC/USD",
    rawCryptoScore: 80,
    current: 100,
    bid: 99.9,
    ask: 100,
    barsFound: 30,
    dollarVolume24h: 0,
    windowDollarVolume: 100_000,
  });
  const explicitZeroDecision = buildCryptoDecisionScore({
    symbol: "BTC/USD",
    rawCryptoScore: 80,
    current: 100,
    bid: 99.9,
    ask: 100,
    barsFound: 30,
    dollarVolume24h: 0,
    windowDollarVolume: 100_000,
  });
  assert.equal(explicitZeroRealism.liquiditySource, "reported_24h");
  assert.equal(explicitZeroDecision.liquidity.source, "reported_24h");
  assert.equal(explicitZeroDecision.liquidity.pass, false);

  const contradictoryAliases = buildCryptoDecisionScore({
    symbol: "BTC/USD",
    rawCryptoScore: 80,
    current: 100,
    bid: 99.9,
    ask: 100,
    barsFound: 30,
    liquiditySource: "reported_24h",
    dollarVolume24h: 0,
    dollarVolume: 2_000_000,
    windowDollarVolume: 100_000,
  });
  assert.equal(contradictoryAliases.liquidity.source, "reported_24h");
  assert.equal(contradictoryAliases.liquidity.dollarVolume, 0);
  assert.equal(contradictoryAliases.liquidity.pass, false);
});

test("missing bid and ask do not fabricate a spread score and fail the entry gate closed", () => {
  const { calculateCryptoInstitutionalQualification } = createScanner();
  const bars = Array.from({ length: 30 }, () => ({ c: 100, v: 100 }));
  const qualification = calculateCryptoInstitutionalQualification({
    quote: { current: 100 },
    score: 90,
    bars,
    liquidityMetrics: {
      dollarVolume: 1_000_000,
      volumeSpikeRatio: 1,
      volumeConfidenceScore: 90,
    },
    spreadPercent: null,
    spreadAvailable: false,
  });
  const realism = calculateCryptoSignalRealism({
    symbol: "ETH/USD",
    rawCryptoScore: 80,
    current: 100,
    spreadAvailable: true,
    barsFound: 30,
    windowDollarVolume: 1_000_000,
  });

  assert.equal(qualification.qualifiedToBuy, false);
  assert.equal(qualification.cryptoInstitutionalQualification.spreadPass, false);
  assert.match(qualification.cryptoInstitutionalQualification.reason, /missing live spread/i);
  assert.equal(realism.spreadAvailable, false);
  assert.equal(realism.spreadPercent, null);
  assert.equal(realism.penaltyComponents.find((item) => item.family === "executionQuality").points, 0);
  assert.ok(realism.entryBlockReasons.includes("MISSING_LIVE_SPREAD"));
});

test("live bid and ask override a contradictory cached spread", () => {
  const signal = {
    symbol: "BTC/USD",
    rawCryptoScore: 90,
    current: 95,
    bid: 90,
    ask: 100,
    spreadAvailable: true,
    spreadPercent: 0,
    barsFound: 30,
    windowDollarVolume: 1_000_000,
  };
  const realism = calculateCryptoSignalRealism(signal);
  const decision = buildCryptoDecisionScore(signal);

  assert.ok(realism.spreadPercent > 10);
  assert.ok(realism.entryBlockReasons.includes("SPREAD_TOO_WIDE"));
  assert.ok(decision.spread.spreadPercent > 10);
  assert.equal(decision.spread.pass, false);
  assert.equal(decision.coreEvidencePass, false);
});

test("crypto realism has one bounded penalty per independent evidence family", () => {
  const result = calculateCryptoSignalRealism({
    symbol: "TINY/USD",
    rawCryptoScore: 90,
    current: 0.001,
    barsFound: 1,
    spreadAvailable: true,
    spreadPercent: 1,
    windowDollarVolume: 1_000,
    percentChange: 0,
  });
  const families = result.penaltyComponents.map((item) => item.family);
  const uniqueFamilies = new Set(families);

  assert.equal(families.length, uniqueFamilies.size);
  assert.ok(result.cryptoRiskPenalty <= 30);
  assert.equal(result.quietMarketPenalty, 0);
  assert.equal(result.missingStatisticalPenalty, 0);
  assert.equal(
    result.penaltyComponents.filter((item) => item.family === "dataCoverage").length,
    1
  );
  const executionFamily = result.penaltyComponents.find(
    (item) => item.family === "executionQuality"
  );
  assert.equal(
    executionFamily.points,
    Math.max(
      executionFamily.evidence.spreadPenalty,
      executionFamily.evidence.liquidityPenalty
    )
  );
});

test("nested statistical evidence is available and major-coin matching uses the exact base asset", () => {
  const nestedStat = calculateCryptoSignalRealism({
    symbol: "BTC/USD",
    rawCryptoScore: 80,
    current: 100,
    bid: 99.9,
    ask: 100,
    barsFound: 30,
    windowDollarVolume: 1_000_000,
    statisticalEdge: { statisticalEdgeScore: 72 },
  });
  const lookalike = calculateCryptoSignalRealism({
    symbol: "ABSOL/USD",
    rawCryptoScore: 80,
    current: 0.001,
    bid: 0.00099,
    ask: 0.001,
    barsFound: 30,
    windowDollarVolume: 1_000_000,
  });

  assert.equal(getCryptoBaseAsset("X:BTCUSD"), "BTC");
  assert.ok(!nestedStat.missingComponents.includes("statisticalEdge"));
  assert.equal(lookalike.memeOrUltraSpeculative, true);
});

test("crypto master components renormalize missing evidence without treating it as zero", () => {
  assert.equal(
    Number(Object.values(CRYPTO_DECISION_WEIGHTS).reduce((sum, weight) => sum + weight, 0).toFixed(4)),
    1
  );
  const result = calculateAvailableWeightedScore([
    { name: "base", source: "realismAdjustedScore", available: true, value: 80, weight: 0.4 },
    { name: "institutional", source: "cryptoInstitutionalScore", available: true, value: 70, weight: 0.3 },
    { name: "execution", source: "unavailable", available: false, value: 0, weight: 0.3 },
  ], { normalizeMissing: true });

  assert.equal(result.score, 75.71);
  assert.equal(result.coverage, 0.7);
  assert.deepEqual(result.missingComponents, ["execution"]);
  assert.equal(
    Number(result.components.reduce((sum, component) => sum + component.contribution, 0).toFixed(2)),
    result.score
  );
});

test("an explicit zero crypto component remains available evidence", () => {
  const result = calculateAvailableWeightedScore([
    { name: "base", available: true, value: 80, weight: 0.5 },
    { name: "execution", available: true, value: 0, weight: 0.5 },
  ], { normalizeMissing: true });

  assert.equal(result.score, 40);
  assert.equal(result.coverage, 1);
  assert.deepEqual(result.missingComponents, []);
});

test("component coverage reports unavailable weight even when score weights are not renormalized", () => {
  const result = calculateAvailableWeightedScore([
    { name: "base", available: true, value: 80, weight: 0.6 },
    { name: "research", available: false, value: 0, weight: 0.4 },
  ]);

  assert.equal(result.score, 48);
  assert.equal(result.coverage, 0.6);
  assert.deepEqual(result.missingComponents, ["research"]);
});

test("crypto decision score uses independent discovery, entry, continuation, and context families", () => {
  const result = buildCryptoDecisionScore({
    symbol: "BTC/USD",
    cryptoDiscoveryScorecard: {
      stage: "CRYPTO_EARLY_DISCOVERY",
      score: 82,
      coverage: 1,
      calculatedAt: new Date().toISOString(),
      extension: { alreadyExtended: false },
    },
    newsCatalyst: { dataAvailable: true, riskDetected: false },
    barsFound: 30,
    current: 100,
    bid: 99.9,
    ask: 100,
    spreadAvailable: true,
    spreadPercent: 0.1,
    windowDollarVolume: 1_000_000,
    cryptoExecutionScore: 76,
    multiDayContinuationScore: 70,
    multiDayAccumulation: { seenDays: ["2026-08-20", "2026-08-21"] },
    cryptoScoreObservations: {
      phase43: { adjustment: 4 },
      phase44: { adjustment: -8 },
      phase48: { adjustment: 2 },
      phase51: { adjustment: 3 },
    },
    cryptoContextScorecard: {
      score: 56,
      independent: true,
      source: "independent_test_context",
    },
  });
  const semanticNames = result.components.map((component) => component.semanticName);

  assert.deepEqual(
    semanticNames,
    ["discovery", "entryQuality", "continuation", "context"]
  );
  assert.equal(result.coreEvidencePass, true);
  assert.equal(result.coverage, 1);
  assert.equal(result.componentsByName.runner.value, 70);
  assert.equal(result.componentsByName.strategyEvolution.value, 56);
  assert.equal(
    result.contextObservations.every((item) => item.included === false),
    true,
    "score-derived phase observations must remain telemetry-only"
  );
});

test("score-derived crypto phase observations cannot become context points", () => {
  const result = buildCryptoDecisionScore({
    symbol: "BTC/USD",
    rawCryptoScore: 82,
    barsFound: 30,
    current: 100,
    bid: 99.9,
    ask: 100.1,
    windowDollarVolume: 1_000_000,
    cryptoScoreObservations: {
      phase43: { adjustment: 8 },
      phase48: { adjustment: 6 },
      phase52: { adjustment: 9 },
    },
  });

  assert.equal(result.componentsByName.strategyEvolution.available, false);
  assert.equal(result.componentsByName.strategyEvolution.contribution, 0);
  assert.ok(result.contextObservations.length > 0);
  assert.ok(result.contextObservations.every((item) => item.included === false));
});

test("shared crypto execution gate requires central and freshly complete evidence", () => {
  const complete = {
    symbol: "BTC/USD",
    cryptoDiscoveryScorecard: {
      stage: "CRYPTO_EARLY_DISCOVERY",
      score: 90,
      coverage: 1,
      calculatedAt: new Date().toISOString(),
      extension: { alreadyExtended: false },
    },
    newsCatalyst: { dataAvailable: true, riskDetected: false },
    masterFinalScore: 90,
    qualifiedToBuy: true,
    autoTradeApproved: true,
    barsFound: 30,
    current: 100,
    bid: 99.95,
    ask: 100.05,
    windowDollarVolume: 1_000_000,
  };

  const missingCentral = evaluateCryptoTradeCandidate(complete, { minimumScore: 85 });
  assert.equal(missingCentral.approved, false);
  assert.ok(missingCentral.reasons.includes("MISSING_CENTRAL_CRYPTO_EVIDENCE"));

  const approved = evaluateCryptoTradeCandidate({
    ...complete,
    centralAutonomousDecisionCore: {
      cryptoDecisionEvidence: { coreEvidencePass: true },
    },
  }, { minimumScore: 85 });
  assert.equal(approved.approved, true);

  const staleCentralWideQuote = evaluateCryptoTradeCandidate({
    ...complete,
    bid: 90,
    ask: 100,
    spreadPercent: 0,
    centralAutonomousDecisionCore: {
      cryptoDecisionEvidence: { coreEvidencePass: true },
    },
  }, { minimumScore: 85 });
  assert.equal(staleCentralWideQuote.approved, false);
  assert.ok(staleCentralWideQuote.reasons.includes("acceptableSpread"));
});

test("derived runner strength is not reused as independent continuation evidence", () => {
  const result = buildCryptoDecisionScore({
    symbol: "BTC/USD",
    rawCryptoScore: 90,
    barsFound: 30,
    current: 100,
    bid: 99.9,
    ask: 100,
    windowDollarVolume: 1_000_000,
    cryptoExecutionScore: 95,
    cryptoRunnerStrength: 95,
  });

  assert.equal(result.componentsByName.runner.available, false);
  assert.ok(result.missingComponents.includes("runner"));
});

test("crypto decision coverage fails closed when a derived score lacks raw spread evidence", () => {
  const result = buildCryptoDecisionScore({
    symbol: "ETH/USD",
    rawCryptoScore: 90,
    barsFound: 30,
    current: 100,
    spreadAvailable: true,
    windowDollarVolume: 1_000_000,
    cryptoExecutionScore: 95,
    cryptoRunnerStrength: 80,
  });

  assert.equal(result.componentsByName.execution.available, false);
  assert.equal(result.coreEvidencePass, false);
  assert.ok(result.missingCriticalEvidence.includes("liveSpread"));
  assert.ok(result.coverage < 1);
});

test("crypto phase observations no longer mutate the canonical score sequentially", () => {
  const strategy = createCryptoIntelligenceStrategy({
    calculateCryptoStrategySelection: () => ({}),
    clampScore,
    engineState: {},
    normalizeSymbol: (symbol) => String(symbol || "").toUpperCase(),
    saveEngineState: () => {},
  });
  const signal = {
    symbol: "BTC/USD",
    score: 78,
    current: 100,
    bid: 99.9,
    ask: 100,
    spreadPercent: 0.1,
    volumeSpikeRatio: 2,
    windowDollarVolume: 1_000_000,
    percentChange: 2,
    cryptoInstitutionalScore: 78,
  };

  const [result] = strategy.applyCryptoExecutionTimingToSignals([signal]);

  assert.equal(result.score, 78);
  assert.equal(result.cryptoScoreObservations.phase44.appliedToDecisionScore, false);
  assert.equal(typeof result.cryptoExecutionScore, "number");

  const missingSpreadExecution = strategy.calculateCryptoExecutionTiming({
    symbol: "ETH/USD",
    current: 100,
    spreadAvailable: true,
    windowDollarVolume: 1_000_000,
  });
  const missingSpreadInstitutional = strategy.calculateCryptoInstitutionalSignal({
    symbol: "ETH/USD",
    rawCryptoScore: 90,
    current: 100,
    spreadAvailable: true,
    windowDollarVolume: 1_000_000,
  });

  assert.equal(missingSpreadExecution.spreadAvailable, false);
  assert.equal(missingSpreadExecution.blockExecution, true);
  assert.equal(missingSpreadInstitutional.spreadAvailable, false);
  assert.equal(missingSpreadInstitutional.suppressCrypto, true);

  const noHistoryLearning = strategy.calculateCryptoReinforcementLearning([{
    symbol: "BTC/USD",
    score: 100,
    cryptoStrategySelectorScore: 100,
  }]).reinforcedSignals[0];
  assert.equal(noHistoryLearning.learningAvailable, false);
  assert.equal(noHistoryLearning.learningAdjustment, 0);
  assert.equal(noHistoryLearning.shouldBoostCrypto, false);
});

test("legacy crypto scores cannot replace a canonical discovery scorecard", () => {
  const result = evaluateCryptoTradeCandidate({
    symbol: "BTC/USD",
    rawCryptoScore: 99,
    masterFinalScore: 99,
    qualifiedToBuy: true,
    autoTradeApproved: true,
    barsFound: 30,
    current: 100,
    bid: 99.95,
    ask: 100.05,
    windowDollarVolume: 1_000_000,
    newsCatalyst: { dataAvailable: true, riskDetected: false },
    centralAutonomousDecisionCore: {
      cryptoDecisionEvidence: { coreEvidencePass: true },
    },
  });

  assert.equal(result.approved, false);
  assert.ok(result.reasons.includes("discovery"));
  assert.ok(result.reasons.includes("discoveryCoverage"));
});

test("stale crypto discovery evidence cannot be refreshed by only a new quote", () => {
  const now = Date.parse("2026-08-26T12:00:00Z");
  const result = evaluateCryptoTradeCandidate({
    symbol: "BTC/USD",
    cryptoDiscoveryScorecard: {
      stage: "CRYPTO_EARLY_DISCOVERY",
      score: 90,
      coverage: 1,
      calculatedAt: "2026-08-26T11:00:00Z",
      extension: { alreadyExtended: false },
    },
    newsCatalyst: { dataAvailable: true, riskDetected: false },
    masterFinalScore: 90,
    qualifiedToBuy: true,
    autoTradeApproved: true,
    barsFound: 30,
    current: 100,
    bid: 99.95,
    ask: 100.05,
    windowDollarVolume: 1_000_000,
    centralAutonomousDecisionCore: {
      cryptoDecisionEvidence: { coreEvidencePass: true },
    },
  }, { now, maxDiscoveryAgeMinutes: 15 });

  assert.equal(result.approved, false);
  assert.ok(result.reasons.includes("freshDiscoveryScorecard"));
});
