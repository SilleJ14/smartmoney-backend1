import test from "node:test";
import assert from "node:assert/strict";
import { buildDecisionScoreTelemetry, buildStockDecisionScore, calculateEarlyDiscoveryScore, calculateEntryQualityScore, calculateMultiDayContinuationScore, evaluateStockTradeCandidate } from "../scoring/decisionScores.js";

const canonicalDiscoveryEvidence = {
  historyDays: 30,
  multiHorizonExtension: {
    coverage: 1,
    alreadyExtended: false,
    extensionPenalty: 0,
  },
};

test("early discovery is independent from unsafe entry timing", () => {
  const signal = { ...canonicalDiscoveryEvidence, percentChange: 7, volumeRatio: 3, preMoveScore: 88, accumulationIntelligence: { accumulationScore: 82 }, catalystScore: 75, lateChaseRisk: true };
  const discovery = calculateEarlyDiscoveryScore(signal);
  const entry = calculateEntryQualityScore({ ...signal, phase5SignalQuality: { hardReject: true, liquidityStabilityScore: 80 } });
  assert.ok(discovery.score >= 75);
  assert.ok(entry.score <= 35);
});

test("quiet pre-move evidence outranks an already-loud sparse mover", () => {
  const quiet = calculateEarlyDiscoveryScore({ ...canonicalDiscoveryEvidence, percentChange: 0.4, relativeVolume: 0.7, preMoveScore: 88, accumulationIntelligence: { accumulationScore: 84 }, catalystScore: 65 });
  const loudAndSparse = calculateEarlyDiscoveryScore({ percentChange: 15 });
  assert.ok(quiet.score >= 72);
  assert.ok(["STRONG_DISCOVERY", "ELITE_DISCOVERY"].includes(quiet.tier));
  assert.ok(loudAndSparse.score < 40);
  assert.equal(loudAndSparse.tier, "LATE_MOVE_NOT_DISCOVERY");
});

test("stock discovery without canonical multi-horizon evidence stays watch-only", () => {
  const result = calculateEarlyDiscoveryScore({
    percentChange: 0.2,
    preMoveScore: 95,
    catalystScore: 90,
  });
  assert.equal(result.score, 55);
  assert.equal(result.canonicalExtensionEvidencePass, false);
  assert.equal(result.tier, "LATE_MOVE_NOT_DISCOVERY");
});

test("stock technical discovery is not reduced when no catalyst is available", () => {
  const discovery = calculateEarlyDiscoveryScore({
    ...canonicalDiscoveryEvidence,
    percentChange: 0.4,
    preMoveScore: 84,
    catalystRanking: {
      catalystAvailable: false,
      catalystScore: 0,
    },
  });

  assert.equal(discovery.score, 84);
  assert.equal(discovery.coverage, 0.85);
  assert.equal(discovery.catalystBonus, 0);
});

test("extreme relative volume is not treated as quiet early discovery", () => {
  const awakening = calculateEarlyDiscoveryScore({
    ...canonicalDiscoveryEvidence,
    percentChange: 0.4,
    relativeVolume: 3,
    accumulationIntelligence: { accumulationScore: 80 },
    catalystScore: 65,
  });
  const alreadyLoud = calculateEarlyDiscoveryScore({
    ...canonicalDiscoveryEvidence,
    percentChange: 0.4,
    relativeVolume: 8,
    accumulationIntelligence: { accumulationScore: 80 },
    catalystScore: 65,
  });
  assert.ok(awakening.score > alreadyLoud.score);
});

test("a fully populated already-loud mover cannot be labeled early discovery", () => {
  const loud = calculateEarlyDiscoveryScore({
    percentChange: 12,
    relativeVolume: 5,
    preMoveScore: 90,
    catalystScore: 90,
  });
  assert.equal(loud.score, 55);
  assert.equal(loud.tier, "LATE_MOVE_NOT_DISCOVERY");
  assert.ok(loud.gates.includes("ALREADY_LOUD_MOVE"));
});

test("entry score consolidates correlated risks with a max risk component", () => {
  const base = { bid: 10, ask: 10.01, confirmations: { aboveVwap: true, closeNearHighPercent: 82 }, technicals: { ema9: 11, ema20: 10, macd: 2, macdSignal: 1, rsi: 60 }, phase5SignalQuality: { liquidityStabilityScore: 80, antiChaseRisk: 80, exhaustionRisk: 80, spreadWideningRisk: 80 } };
  const oneRisk = calculateEntryQualityScore(base);
  const repeatedRisk = calculateEntryQualityScore({ ...base, phase5SignalQuality: { ...base.phase5SignalQuality, antiChaseRisk: 80, exhaustionRisk: 20, spreadWideningRisk: 20 } });
  assert.equal(oneRisk.components.find((c) => c.name === "riskProtection").value, repeatedRisk.components.find((c) => c.name === "riskProtection").value);
});

test("entry approval fails closed when execution evidence is missing", () => {
  const sparse = calculateEntryQualityScore({
    confirmations: { aboveVwap: true },
    technicals: { ema9: 11, ema20: 10, macd: 2, macdSignal: 1, rsi: 60 },
  });
  assert.equal(sparse.approved, false);
  assert.equal(sparse.tier, "WAIT_FOR_DATA");
  assert.ok(sparse.missingComponents.includes("liquidityExecution"));
  assert.ok(sparse.missingComponents.includes("priceLocation"));
});

test("explicitly unavailable news-risk data blocks stock entry but not discovery", () => {
  const signal = {
    ...canonicalDiscoveryEvidence,
    percentChange: 0.3,
    preMoveScore: 85,
    requireNewsRiskForEntry: true,
    confirmations: {
      aboveVwap: true,
      closeNearHighPercent: 85,
      fakeBreakout: false,
      newsRiskAvailable: false,
    },
    bid: 10,
    ask: 10.01,
    technicalBarsFound: 30,
    technicals: { ema9: 11, ema20: 10, macd: 2, macdSignal: 1, rsi: 60 },
    phase5SignalQuality: {
      liquidityStabilityScore: 90,
      antiChaseRisk: 10,
      exhaustionRisk: 10,
      spreadWideningRisk: 10,
      breakoutRetestConfirmation: true,
    },
  };
  const discovery = calculateEarlyDiscoveryScore(signal);
  const entry = calculateEntryQualityScore(signal);

  assert.ok(discovery.score >= 65);
  assert.equal(entry.approved, false);
  assert.ok(entry.gates.includes("NEWS_RISK_UNAVAILABLE"));
});

test("news availability only hard-blocks Entry when the production risk check is required", () => {
  const entry = calculateEntryQualityScore({
    requireNewsRiskForEntry: false,
    confirmations: {
      aboveVwap: true,
      closeNearHighPercent: 85,
      fakeBreakout: false,
      newsRiskAvailable: false,
    },
    bid: 10,
    ask: 10.01,
    technicalBarsFound: 30,
    technicals: { ema9: 11, ema20: 10, macd: 2, macdSignal: 1, rsi: 60 },
    phase5SignalQuality: {
      liquidityStabilityScore: 90,
      antiChaseRisk: 10,
      exhaustionRisk: 10,
      spreadWideningRisk: 10,
      breakoutRetestConfirmation: true,
    },
  });

  assert.equal(entry.newsRiskRequired, false);
  assert.equal(entry.gates.includes("NEWS_RISK_UNAVAILABLE"), false);
  assert.equal(entry.approved, true);
});

test("entry approval requires a measured stock spread and enough technical bars", () => {
  const base = {
    confirmations: { aboveVwap: true, closeNearHighPercent: 82, fakeBreakout: false },
    technicals: { ema9: 11, ema20: 10, macd: 2, macdSignal: 1, rsi: 60 },
    phase5SignalQuality: { liquidityStabilityScore: 85, antiChaseRisk: 15, exhaustionRisk: 15, spreadWideningRisk: 10, breakoutRetestConfirmation: true },
  };
  const missingSpread = calculateEntryQualityScore({ ...base, technicalBarsFound: 30 });
  assert.equal(missingSpread.approved, false);
  assert.ok(missingSpread.gates.includes("MISSING_SPREAD_EVIDENCE"));
  const tooFewBars = calculateEntryQualityScore({ ...base, bid: 10, ask: 10.01, technicalBarsFound: 10 });
  assert.equal(tooFewBars.approved, false);
  assert.ok(tooFewBars.missingComponents.includes("trendAlignment"));
  const complete = calculateEntryQualityScore({ ...base, bid: 10, ask: 10.01, technicalBarsFound: 30 });
  assert.equal(complete.approved, true);
  const costlyButBelowLimit = calculateEntryQualityScore({
    ...base,
    bid: 9.96,
    ask: 10.04,
    technicalBarsFound: 30,
  });
  assert.ok(costlyButBelowLimit.score < complete.score);
  assert.ok(costlyButBelowLimit.spreadPenalty > complete.spreadPenalty);

  const staleCachedSpread = calculateEntryQualityScore({
    ...base,
    spreadPercent: 0.1,
    bid: 10,
    ask: 10.5,
    technicalBarsFound: 30,
  });
  assert.equal(staleCachedSpread.approved, false);
  assert.equal(staleCachedSpread.spreadSource, "signal_bid_ask");
  assert.ok(staleCachedSpread.gates.includes("SPREAD_ABOVE_EXECUTION_LIMIT"));
});

test("extreme independent entry risk blocks an otherwise strong setup", () => {
  const score = calculateEntryQualityScore({
    bid: 10,
    ask: 10.01,
    technicalBarsFound: 30,
    confirmations: { aboveVwap: true, closeNearHighPercent: 90, fakeBreakout: false },
    technicals: { ema9: 11, ema20: 10, macd: 2, macdSignal: 1, rsi: 60 },
    phase5SignalQuality: {
      liquidityStabilityScore: 90,
      antiChaseRisk: 80,
      exhaustionRisk: 10,
      spreadWideningRisk: 10,
      breakoutRetestConfirmation: true,
    },
  });
  assert.equal(score.approved, false);
  assert.equal(score.tier, "BLOCKED");
  assert.ok(score.gates.includes("EXTREME_ENTRY_RISK"));
});

test("multi-day continuation requires observed multi-session evidence", () => {
  const strong = calculateMultiDayContinuationScore({ multiDayAccumulation: { persistenceScore: 88, supportHoldingScore: 85, seenDays: ["2026-08-17", "2026-08-18", "2026-08-19", "2026-08-20"] }, confirmations: { aboveVwap: true, closeNearHigh: true }, technicals: { ema9: 12, ema20: 10 } });
  const newMover = calculateMultiDayContinuationScore({ percentChange: 30, volumeRatio: 8, confirmations: { aboveVwap: true }, technicals: { ema9: 12, ema20: 10 } });
  assert.ok(strong.score >= 75);
  assert.ok(newMover.score < strong.score);
  assert.ok(newMover.missingComponents.includes("observedPersistence"));
});

test("multi-day continuation counts unique sessions instead of duplicate observations", () => {
  const shared = { persistenceScore: 92, supportHoldingScore: 90 };
  const duplicate = calculateMultiDayContinuationScore({ multiDayAccumulation: { ...shared, seenDays: ["2026-08-21", "2026-08-21", "2026-08-21", "2026-08-21"] }, confirmations: { aboveVwap: true, closeNearHigh: true }, technicals: { ema9: 12, ema20: 10 } });
  const unique = calculateMultiDayContinuationScore({ multiDayAccumulation: { ...shared, seenDays: ["2026-08-18", "2026-08-19", "2026-08-20", "2026-08-21"] }, confirmations: { aboveVwap: true, closeNearHigh: true }, technicals: { ema9: 12, ema20: 10 } });
  assert.equal(duplicate.observedSessions, 1);
  assert.equal(duplicate.tier, "INTRADAY_ONLY");
  assert.equal(unique.observedSessions, 4);
  assert.ok(["STRONG_CONTINUATION", "ELITE_CONTINUATION"].includes(unique.tier));
});

test("multi-day continuation excludes the still-open current session", () => {
  const score = calculateMultiDayContinuationScore({
    multiDayAccumulation: {
      persistenceScore: 95,
      supportHoldingScore: 95,
      seenDays: ["2026-08-18", "2026-08-19", "2026-08-20"],
    },
    confirmations: { aboveVwap: true, closeNearHigh: true },
    technicals: { ema9: 12, ema20: 10 },
  }, { now: Date.parse("2026-08-20T15:00:00-04:00") });
  assert.deepEqual(score.observedSessionDays, ["2026-08-18", "2026-08-19"]);
  assert.notEqual(score.tier, "STRONG_CONTINUATION");
});

test("multi-day continuation excludes weekends from observed sessions", () => {
  const score = calculateMultiDayContinuationScore({
    multiDayAccumulation: {
      seenDays: ["2026-08-21", "2026-08-22", "2026-08-23"],
      persistenceScore: 90,
      supportHoldingScore: 90,
    },
    confirmations: { aboveVwap: true, closeNearHigh: true },
    technicals: { ema9: 11, ema20: 10 },
    exhaustionRisk: 10,
  }, { now: Date.parse("2026-08-24T15:00:00Z") });

  assert.equal(score.observedSessions, 1);
  assert.deepEqual(score.observedSessionDays, ["2026-08-21"]);
  assert.equal(score.tier, "INTRADAY_ONLY");
});

test("decision telemetry exposes every component value, weight, and contribution", () => {
  const telemetry = buildDecisionScoreTelemetry({ percentChange: 4, volumeRatio: 2, confirmations: { aboveVwap: true, closeNearHighPercent: 75 }, technicals: { ema9: 11, ema20: 10 }, multiDayAccumulation: { persistenceScore: 70, supportHoldingScore: 75, seenDays: [1, 2] } });
  assert.deepEqual(Object.keys(telemetry.scores), ["discovery", "entry", "continuation", "decision"]);
  for (const stage of Object.values(telemetry.stages)) {
    assert.ok(stage.components.length > 0);
    for (const item of stage.components) {
      assert.equal(typeof item.value, "number");
      assert.equal(typeof item.weight, "number");
      assert.equal(typeof item.contribution, "number");
      assert.equal(typeof item.source, "string");
      assert.equal(typeof item.effectiveWeight, "number");
      assert.ok(Math.abs(item.value * item.effectiveWeight - item.contribution) <= 0.06);
    }
    const contributionTotal = stage.components.reduce((sum, item) => sum + item.contribution, 0);
    assert.ok(Math.abs(contributionTotal - stage.score) <= 0.05);
    for (const item of stage.components.filter((component) => !component.available)) {
      assert.equal(item.contribution, 0);
    }
  }
});

test("stock final decision uses independent score families and requires entry evidence", () => {
  const decision = buildStockDecisionScore({
    discoveryScorecard: { score: 84, coverage: 1 },
    entryQualityScorecard: { score: 80, coverage: 1, approved: true },
    contextScore: 70,
    riskPortfolioScore: 75,
  });
  assert.equal(decision.coreEvidencePass, true);
  assert.deepEqual(decision.components.map((item) => item.name), ["discovery", "entry", "marketContext", "riskPortfolio", "fundamentals"]);
  assert.ok(Math.abs(decision.components.reduce((sum, item) => sum + item.contribution, 0) - decision.score) <= 0.05);
  const incomplete = buildStockDecisionScore({
    discoveryScorecard: { score: 90, coverage: 1 },
    entryQualityScorecard: { score: 90, coverage: 0.6, approved: false },
    contextScore: 90,
    riskPortfolioScore: 90,
  });
  assert.equal(incomplete.coreEvidencePass, false);
});

test("missing optional stock evidence cannot improve the final score", () => {
  const complete = buildStockDecisionScore({
    discoveryScorecard: { score: 80, coverage: 1 },
    entryQualityScorecard: { score: 80, coverage: 1, approved: true },
    contextScore: 70,
    riskPortfolioScore: 70,
    fundamentalBlendScore: 70,
    fundamentalDataValid: true,
  });
  const missingFundamentals = buildStockDecisionScore({
    discoveryScorecard: { score: 80, coverage: 1 },
    entryQualityScorecard: { score: 80, coverage: 1, approved: true },
    contextScore: 70,
    riskPortfolioScore: 70,
  });
  assert.ok(missingFundamentals.score < complete.score);
  assert.ok(missingFundamentals.missingEvidencePenalty > 0);
});

test("bounded reinforcement changes the canonical stock decision score", () => {
  const base = {
    discoveryScorecard: { score: 92, coverage: 1 },
    entryQualityScorecard: { score: 82, coverage: 1, approved: true },
    contextScore: 55,
    riskPortfolioScore: 55,
    fundamentalBlendScore: 30,
    fundamentalDataValid: true,
  };
  const discoveryWeighted = buildStockDecisionScore({
    ...base,
    reinforcementLearningActive: true,
    reinforcementWeights: { momentum: 0.5, statisticalEdge: 0.5, technicals: 0.1, macro: 0.1, riskQuality: 0.15, fundamentals: 0.12 },
  });
  const entryWeighted = buildStockDecisionScore({
    ...base,
    reinforcementLearningActive: true,
    reinforcementWeights: { momentum: 0.05, statisticalEdge: 0.05, technicals: 0.5, macro: 0.1, riskQuality: 0.15, fundamentals: 0.12 },
  });
  assert.notEqual(discoveryWeighted.score, entryWeighted.score);
  assert.equal(discoveryWeighted.reinforcementWeightsApplied, true);
  assert.ok(Object.values(discoveryWeighted.effectiveWeights).every((value) => value > 0));
});

test("legacy reinforcement weights stay inactive without enough measured samples", () => {
  const base = {
    discoveryScorecard: { score: 92, coverage: 1 },
    entryQualityScorecard: { score: 82, coverage: 1, approved: true },
    contextScore: 55,
    riskPortfolioScore: 55,
    fundamentalBlendScore: 30,
    fundamentalDataValid: true,
  };
  const baseline = buildStockDecisionScore(base);
  const premature = buildStockDecisionScore({
    ...base,
    reinforcementWeights: {
      momentum: 0.5,
      statisticalEdge: 0.5,
      technicals: 0.1,
      macro: 0.1,
      riskQuality: 0.15,
      fundamentals: 0.12,
    },
  });

  assert.equal(premature.score, baseline.score);
  assert.equal(premature.reinforcementWeightsApplied, false);
  assert.equal(premature.reinforcementLearningActive, false);
});

test("bounded outcome learning changes weights only when activated", () => {
  const base = {
    discoveryScorecard: { score: 95, coverage: 1 },
    entryQualityScorecard: { score: 70, coverage: 1, approved: true },
    contextScore: 60,
    riskPortfolioScore: 60,
  };
  const inactive = buildStockDecisionScore({
    ...base,
    stockOutcomeLearning: {
      active: false,
      componentMultipliers: { discovery: 1.05, entry: 0.95 },
    },
  });
  const active = buildStockDecisionScore({
    ...base,
    stockOutcomeLearning: {
      active: true,
      sampleCount: 30,
      componentMultipliers: {
        discovery: 1.05,
        entry: 0.95,
        marketContext: 1,
        riskPortfolio: 1,
        fundamentals: 1,
      },
    },
  });
  assert.equal(inactive.outcomeLearningApplied, false);
  assert.equal(active.outcomeLearningApplied, true);
  assert.equal(active.outcomeLearningSampleCount, 30);
  assert.ok(active.effectiveWeights.discovery > inactive.effectiveWeights.discovery);
  assert.ok(active.effectiveWeights.entry < inactive.effectiveWeights.entry);
});

test("stock execution enforces final, entry, coverage, and acceleration thresholds", () => {
  const regular = evaluateStockTradeCandidate({
    masterFinalScore: 78,
    entryQualityScore: 75,
    entryQualityScorecard: { approved: true, coverage: 0.8 },
    discoveryScorecard: { coverage: 0.65 },
    decisionScoreCoverage: 0.8,
    centralAutonomousAction: "ALLOW",
    riskScore: 70,
    spreadPercent: 0.2,
    quoteFetchedAt: new Date().toISOString(),
  }, { requireCentralDecision: true });
  assert.equal(regular.approved, true);
  assert.equal(regular.accelerated, false);
  assert.equal(regular.watchlistEligible, true);
  assert.equal(regular.qualifiedCandidate, true);
  const accelerated = evaluateStockTradeCandidate({
    masterFinalScore: 85,
    entryQualityScore: 82,
    entryQualityScorecard: { approved: true, coverage: 0.8 },
    discoveryScorecard: { coverage: 0.65 },
    decisionScoreCoverage: 0.8,
    centralAutonomousAction: "ACCELERATE_CAPITAL",
    riskScore: 70,
    spreadPercent: 0.2,
    quoteFetchedAt: new Date().toISOString(),
  }, { requireCentralDecision: true });
  assert.equal(accelerated.accelerated, true);
  const incomplete = evaluateStockTradeCandidate({
    masterFinalScore: 95,
    entryQualityScore: 95,
    entryQualityScorecard: { approved: true, coverage: 0.79 },
    discoveryScorecard: { coverage: 0.65 },
    decisionScoreCoverage: 0.8,
    centralAutonomousAction: "ALLOW",
    riskScore: 70,
    quoteFetchedAt: new Date().toISOString(),
  }, { requireCentralDecision: true });
  assert.equal(incomplete.approved, false);
  assert.ok(incomplete.reasons.includes("ENTRY_COVERAGE_BELOW_80_PERCENT"));
  const watchOnly = evaluateStockTradeCandidate({
    masterFinalScore: 60,
    entryQualityScore: 65,
    entryQualityScorecard: { approved: false, coverage: 0.8 },
    discoveryScorecard: { coverage: 0.65 },
    decisionScoreCoverage: 0.8,
  });
  assert.equal(watchOnly.watchlistEligible, true);
  assert.equal(watchOnly.qualifiedCandidate, false);
});

test("server execution rejects stale and future stock decisions even with a fresh quote", () => {
  const now = Date.parse("2026-08-29T14:00:00.000Z");
  const base = {
    masterFinalScore: 90,
    entryQualityScore: 90,
    entryQualityScorecard: { approved: true, coverage: 1 },
    discoveryScorecard: { coverage: 1 },
    decisionScoreCoverage: 1,
    centralAutonomousAction: "ALLOW",
    riskScore: 70,
    spreadPercent: 0.2,
    quoteFetchedAt: new Date(now).toISOString(),
  };
  const stale = evaluateStockTradeCandidate({
    ...base,
    decisionUpdatedAt: "2020-01-01T00:00:00.000Z",
  }, { requireCentralDecision: true, requireFreshDecision: true, now });
  assert.equal(stale.approved, false);
  assert.ok(stale.reasons.includes("DECISION_STALE"));

  const fresh = evaluateStockTradeCandidate({
    ...base,
    decisionUpdatedAt: new Date(now).toISOString(),
  }, { requireCentralDecision: true, requireFreshDecision: true, now });
  assert.equal(fresh.approved, true);
});

test("final stock gate cannot approve incomplete core evidence or a central block", () => {
  const base = {
    masterFinalScore: 90,
    entryQualityScore: 90,
    entryQualityScorecard: { approved: true, coverage: 1 },
    discoveryScorecard: { coverage: 0.6 },
    decisionScoreCoverage: 1,
    centralAutonomousAction: "ALLOW",
    riskScore: 70,
    quoteFetchedAt: new Date().toISOString(),
  };
  const incomplete = evaluateStockTradeCandidate(base, { requireCentralDecision: true });
  assert.equal(incomplete.approved, false);
  assert.ok(incomplete.reasons.includes("CORE_EVIDENCE_FAILED"));
  const blocked = evaluateStockTradeCandidate({
    ...base,
    discoveryScorecard: { coverage: 1 },
    centralAutonomousAction: "BLOCK",
  }, { requireCentralDecision: true });
  assert.equal(blocked.approved, false);
  assert.ok(blocked.reasons.includes("CENTRAL_DECISION_NOT_EXECUTABLE"));
});

test("final stock gate enforces explicit buy blocks and the execution spread limit", () => {
  const base = {
    masterFinalScore: 90,
    entryQualityScore: 90,
    entryQualityScorecard: { approved: true, coverage: 1 },
    discoveryScorecard: { coverage: 1 },
    decisionScoreCoverage: 1,
    centralAutonomousAction: "ALLOW",
    riskScore: 70,
    quoteFetchedAt: new Date().toISOString(),
  };
  const displayOnly = evaluateStockTradeCandidate({
    ...base,
    blockBuying: true,
    buyBlocked: true,
    displayOnly: true,
  }, { requireCentralDecision: true });
  assert.equal(displayOnly.approved, false);
  assert.equal(displayOnly.explicitBuyBlock, true);
  assert.ok(displayOnly.reasons.includes("EXPLICIT_BUY_BLOCK"));

  const wideSpread = evaluateStockTradeCandidate({
    ...base,
    spreadPercent: 2.51,
  }, { requireCentralDecision: true, maxSpreadPercent: 2.5 });
  assert.equal(wideSpread.approved, false);
  assert.equal(wideSpread.spreadTooWide, true);
  assert.ok(wideSpread.reasons.includes("SPREAD_ABOVE_EXECUTION_LIMIT"));

  const staleCachedSpread = evaluateStockTradeCandidate({
    ...base,
    spreadPercent: 0.2,
    bid: 10,
    ask: 10.5,
  }, { requireCentralDecision: true, maxSpreadPercent: 2.5 });
  assert.equal(staleCachedSpread.approved, false);
  assert.equal(staleCachedSpread.spreadSource, "signal_bid_ask");
  assert.ok(staleCachedSpread.reasons.includes("SPREAD_ABOVE_EXECUTION_LIMIT"));

  const legacySuppression = evaluateStockTradeCandidate({
    ...base,
    phase9LiquiditySuppressed: true,
  }, { requireCentralDecision: true });
  assert.equal(legacySuppression.approved, false);
  assert.ok(legacySuppression.reasons.includes("EXPLICIT_BUY_BLOCK"));
});

test("final stock gate requires minimum measured risk quality", () => {
  const base = {
    masterFinalScore: 90,
    entryQualityScore: 90,
    entryQualityScorecard: { approved: true, coverage: 1 },
    discoveryScorecard: { coverage: 1 },
    decisionScoreCoverage: 1,
    centralAutonomousAction: "ALLOW",
    quoteFetchedAt: new Date().toISOString(),
    spreadPercent: 0.2,
  };
  const unavailable = evaluateStockTradeCandidate(base, { requireCentralDecision: true });
  assert.equal(unavailable.approved, false);
  assert.ok(unavailable.reasons.includes("RISK_QUALITY_UNAVAILABLE"));
  const weak = evaluateStockTradeCandidate({ ...base, riskScore: 20 }, { requireCentralDecision: true });
  assert.equal(weak.approved, false);
  assert.ok(weak.reasons.includes("RISK_QUALITY_BELOW_55"));
  const controlled = evaluateStockTradeCandidate({ ...base, riskScore: 70 }, { requireCentralDecision: true });
  assert.equal(controlled.approved, true);
});

test("final stock gate requires a fresh quote for executable approval", () => {
  const now = Date.parse("2026-08-25T14:00:00Z");
  const base = {
    masterFinalScore: 90,
    entryQualityScore: 90,
    entryQualityScorecard: { approved: true, coverage: 1 },
    discoveryScorecard: { coverage: 1 },
    decisionScoreCoverage: 1,
    centralAutonomousAction: "ALLOW",
    riskScore: 70,
    spreadPercent: 0.2,
  };
  const missing = evaluateStockTradeCandidate(base, {
    requireCentralDecision: true,
    now,
  });
  assert.equal(missing.approved, false);
  assert.ok(missing.reasons.includes("QUOTE_FRESHNESS_UNAVAILABLE"));
  const genericSignalTimestamp = evaluateStockTradeCandidate({
    ...base,
    updatedAt: "2026-08-25T13:59:59Z",
    scanBuiltAt: "2026-08-25T13:59:59Z",
  }, {
    requireCentralDecision: true,
    now,
  });
  assert.equal(genericSignalTimestamp.approved, false);
  assert.ok(genericSignalTimestamp.reasons.includes("QUOTE_FRESHNESS_UNAVAILABLE"));
  const stale = evaluateStockTradeCandidate({
    ...base,
    quoteFetchedAt: "2026-08-25T13:59:00Z",
  }, {
    requireCentralDecision: true,
    maxQuoteAgeSeconds: 15,
    now,
  });
  assert.equal(stale.approved, false);
  assert.ok(stale.reasons.includes("QUOTE_STALE"));
  const fresh = evaluateStockTradeCandidate({
    ...base,
    quoteFetchedAt: "2026-08-25T13:59:55Z",
  }, {
    requireCentralDecision: true,
    maxQuoteAgeSeconds: 15,
    now,
  });
  assert.equal(fresh.approved, true);
});

test("qualified band requires an approved Entry score", () => {
  const result = evaluateStockTradeCandidate({
    masterFinalScore: 74,
    entryQualityScore: 55,
    entryQualityScorecard: { approved: false, coverage: 1 },
    discoveryScorecard: { coverage: 1 },
    decisionScoreCoverage: 1,
  });
  assert.equal(result.watchlistEligible, true);
  assert.equal(result.qualifiedCandidate, false);
});

test("canonical risk component combines actual risk quality with portfolio fit", () => {
  const base = {
    discoveryScorecard: { score: 85, coverage: 1 },
    entryQualityScorecard: { score: 85, coverage: 1, approved: true },
    contextScore: 75,
    portfolioScore: 90,
  };
  const weakRisk = buildStockDecisionScore({ ...base, riskScore: 20 });
  const strongRisk = buildStockDecisionScore({ ...base, riskScore: 90 });
  assert.ok(strongRisk.score > weakRisk.score);
  const component = weakRisk.components.find((item) => item.name === "riskPortfolio");
  assert.equal(component.value, 41);
  assert.equal(component.source, "risk_quality_70_portfolio_fit_30");
});

test("stock execution fails closed on invalid final score and missing spread", () => {
  const base = {
    masterFinalScore: 90,
    entryQualityScore: 90,
    entryQualityScorecard: { approved: true, coverage: 1 },
    discoveryScorecard: { coverage: 1 },
    decisionScoreCoverage: 1,
    centralAutonomousAction: "ALLOW",
    riskScore: 70,
    quoteFetchedAt: new Date().toISOString(),
  };
  const missingSpread = evaluateStockTradeCandidate(base, { requireCentralDecision: true });
  assert.equal(missingSpread.approved, false);
  assert.ok(missingSpread.reasons.includes("SPREAD_UNAVAILABLE"));

  const invalidScore = evaluateStockTradeCandidate({
    ...base,
    masterFinalScore: "not-a-score",
    spreadPercent: 0.2,
  }, { requireCentralDecision: true });
  assert.equal(invalidScore.approved, false);
  assert.ok(invalidScore.reasons.includes("FINAL_SCORE_INVALID"));
});
