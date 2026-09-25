import test from "node:test";
import assert from "node:assert/strict";
import { scoreEntryFamilies } from "../scoring/entryFamilies.js";
import { classifySetupState, setupEntryBlock } from "../scoring/setupStateClassifier.js";
import { calculateEntryQualityScore, evaluateStockTradeCandidate } from "../scoring/decisionScores.js";
import { evaluateBuyable } from "../scoring/analyticalAuthorization.js";
import { assessContinuationSetup } from "../scoring/continuationSetup.js";

const passingLayers = { C: "PASS", X: "PASS", R: "PASS", S: 100 };

function quietBars(count = 40) {
  return Array.from({ length: count }, () => ({
    open: 10,
    high: 10.16,
    low: 9.9,
    close: 10.04,
    volume: 0,
  }));
}

function bullish() {
  return {
    price: 10.2,
    technicalBarsFound: 40,
    chartBars: quietBars(),
    technicals: { ema9: 10.4, ema20: 10, rsi: 60, macd: 0.4, macdSignal: 0.1 },
    bid: 10.2,
    ask: 10.22,
  };
}

test("a clean breakout can pass without pullback or retest evidence", () => {
  const result = scoreEntryFamilies({
    ...bullish(),
    setupState: "BREAKOUT",
    relativeVolume: 2,
    breakoutStructure: { clearedResistance: true, structureIntact: true },
  });
  assert.equal(result.setupType, "BREAKOUT");
  assert.deepEqual(result.consideredPolicies, ["BREAKOUT"]);
  assert.equal(result.entryApproved, true);
  assert.equal(result.requiredEvidencePass, true);
  assert.equal(result.families.structure.requirement, "REQUIRED");
  assert.equal(result.families.volume.requirement, "REQUIRED");
  assert.ok(result.families.structure.inputs.every((item) => !/pullback|retest/.test(item.id)));
  assert.equal(result.replacesProductionEntry, false);
  assert.equal(result.productionEntryGate, 75);
});

test("a pullback can pass from trend and ATR depth without a volume spike", () => {
  const result = scoreEntryFamilies({
    ...bullish(),
    setupState: "PULLBACK",
    technicals: { ema9: 10.4, ema20: 10 },
    relativeVolume: null,
    pullbackStructure: { trendIntact: true, depthAtr: 1.1, levelUnbroken: true },
  });
  assert.equal(result.setupType, "PULLBACK");
  assert.equal(result.families.volume.score, null);
  assert.equal(result.families.volume.requirement, "SUPPORTIVE");
  assert.equal(result.families.volatility.inputs[0].id, "pullback-depth-atr");
  assert.equal(result.entryApproved, true);
  assert.ok(result.entryCoverage < 1);
});

test("a retest is scored with the retest matrix", () => {
  const result = scoreEntryFamilies({
    ...bullish(),
    setupState: "RETEST",
    continuationStructure: { returnedToLevel: true, supportHeld: true, priorBreakout: true },
  });
  assert.equal(result.setupType, "RETEST");
  assert.deepEqual(result.consideredPolicies, ["RETEST"]);
  assert.equal(result.families.structure.inputs.some((item) => item.id === "retest"), true);
  assert.equal(result.families.structure.inputs.some((item) => item.id === "pullback-inside-trend"), false);
  assert.equal(result.entryApproved, true);
});

test("continuation evidence does not bypass a final score under 70", () => {
  const now = Date.now();
  const chartBars = Array.from({ length: 20 }, (_, index) => ({
    t: now - (20 - index) * 300000,
    o: 99,
    h: 104,
    l: 97,
    c: 100,
    v: 1000,
  }));
  chartBars.splice(-3, 3,
    { t: now - 900000, o: 99.5, h: 100, l: 99, c: 99.8, v: 2000 },
    { t: now - 600000, o: 99.8, h: 100.2, l: 99.4, c: 100, v: 2000 },
    { t: now - 300000, o: 100, h: 101.2, l: 99.8, c: 101, v: 2000 });
  const setup = assessContinuationSetup({ symbol: "RUN", chartBars, price: 101, percentChange: 4, volume: 1000000 });
  assert.equal(setup.eligible, true);
  const iso = new Date(now).toISOString();
  const gate = evaluateStockTradeCandidate({
    masterFinalScore: 60,
    stockDecisionScore: 60,
    stockDecisionScoreAvailable: true,
    discoveryLane: "MEASURED_CONTINUATION",
    continuationSetup: setup,
    entryQualityScore: 80,
    entryQualityScorecard: { approved: true, coverage: 1 },
    centralAutonomousAction: "ALLOW",
    spreadPercent: 0.2,
    liveQuoteUpdatedAt: iso,
    spreadUpdatedAt: iso,
    liveQuoteSource: "alpaca_latest_stock_quote",
    spreadSource: "alpaca_latest_stock_quote",
    priceIsLive: true,
    decisionUpdatedAt: iso,
  }, { requireCentralDecision: true, requireFreshDecision: true, now });
  assert.equal(gate.approved, false);
  assert.equal(gate.qualifiedCandidate, false);
  assert.ok(gate.reasons.includes("FINAL_SCORE_BELOW_70"));
  const decision = evaluateBuyable({
    authorizedDecisionValid: true,
    authorizedDecisionScore: 60,
    currentAnalyticalScore: 60,
    entryApproved: true,
    ...passingLayers,
  });
  assert.equal(decision.buyable, false);
});

test("a reversal is not rejected only because EMA9 is still below EMA20", () => {
  const result = scoreEntryFamilies({
    ...bullish(),
    setupState: "REVERSAL",
    technicals: { ema9: 9.6, ema20: 10, rsi: 58, macd: 0.4, macdSignal: 0.1 },
    reversalStructure: { priorTrend: "BEARISH", trendWeakening: true, reclaimed: true },
  });
  assert.equal(result.families.trend.score, 78);
  assert.equal(result.families.trend.inputs[0].id, "trend-change");
  assert.equal(result.families.trend.requirement, "REQUIRED");
  assert.equal(result.entryApproved, true);
});

test("ignition volume without a structural trigger does not qualify", () => {
  const result = scoreEntryFamilies({
    ...bullish(),
    setupState: "IGNITION",
    relativeVolume: 3,
    runnerStage: "IGNITION",
  });
  assert.equal(result.families.volume.score > 0, true);
  assert.equal(result.families.structure.score, null);
  assert.equal(result.families.structure.requirement, "REQUIRED");
  assert.equal(result.entryApproved, false);
  assert.equal(result.evidenceGate.state, "WAIT");
  assert.ok(result.evidenceGate.reasons.includes("REQUIRED_ENTRY_EVIDENCE_UNKNOWN"));
});

test("one candidate is scored with the classified setup only", () => {
  const facts = {
    price: 10,
    pullbackStructure: { trendIntact: true, depthAtr: 1.1, levelUnbroken: true },
    runnerStage: "IGNITION",
    relativeVolume: 2.4,
    ignitionStructure: { claimed: true },
  };
  const classified = classifySetupState(facts);
  assert.equal(classified.state, "PULLBACK");
  const scored = scoreEntryFamilies({
    ...bullish(),
    ...facts,
    setupState: classified.state,
    technicals: { ema9: 10.4, ema20: 10 },
  });
  assert.deepEqual(scored.consideredPolicies, ["PULLBACK"]);
  assert.equal(scored.entryApproved, true);
  const ignitionOnly = scoreEntryFamilies({
    ...bullish(),
    setupState: "IGNITION",
    relativeVolume: 2.4,
    ignitionStructure: { claimed: true },
  });
  assert.equal(ignitionOnly.entryApproved, false);
  assert.deepEqual(ignitionOnly.consideredPolicies, ["IGNITION"]);
});

test("a missing required family waits instead of scoring zero", () => {
  const result = scoreEntryFamilies({
    ...bullish(),
    setupState: "BREAKOUT",
    breakoutStructure: { clearedResistance: true, structureIntact: true },
  });
  assert.equal(result.families.volume.score, null);
  assert.notEqual(result.families.volume.score, 0);
  assert.equal(result.families.volume.requirement, "REQUIRED");
  assert.equal(result.evidenceGate.state, "WAIT");
  assert.ok(result.evidenceGate.reasons.includes("REQUIRED_ENTRY_EVIDENCE_UNKNOWN"));
  assert.equal(result.entryApproved, false);
});

test("a missing supportive family lowers coverage and does not reject the setup", () => {
  const result = scoreEntryFamilies({
    ...bullish(),
    setupState: "PULLBACK",
    technicals: { ema9: 10.4, ema20: 10 },
    pullbackStructure: { trendIntact: true, depthAtr: 1.1, levelUnbroken: true },
  });
  assert.equal(result.families.momentum.score, null);
  assert.equal(result.families.momentum.requirement, "SUPPORTIVE");
  assert.equal(result.families.volume.score, null);
  assert.equal(result.requiredEvidencePass, true);
  assert.equal(result.entryApproved, true);
  assert.ok(result.entryCoverage < 1);
  assert.ok(result.entryCoverage > 0);
});

test("F at 70 with a failed entry is not buyable", () => {
  const decision = evaluateBuyable({
    authorizedDecisionValid: true,
    authorizedDecisionScore: 74,
    currentAnalyticalScore: 74,
    entryApproved: false,
    ...passingLayers,
  });
  assert.equal(decision.buyable, false);
  assert.equal(decision.reason, "ENTRY_POLICY_FAILED");
  const now = new Date().toISOString();
  const gate = evaluateStockTradeCandidate({
    masterFinalScore: 74,
    stockDecisionScore: 74,
    stockDecisionScoreAvailable: true,
    entryQualityScore: 40,
    entryQualityScorecard: { approved: false, coverage: 0.4 },
    centralAutonomousAction: "ALLOW",
    spreadPercent: 0.2,
    liveQuoteUpdatedAt: now,
    spreadUpdatedAt: now,
    liveQuoteSource: "alpaca_latest_stock_quote",
    spreadSource: "alpaca_latest_stock_quote",
    priceIsLive: true,
  }, { requireCentralDecision: true });
  assert.equal(gate.approved, false);
  assert.equal(gate.qualifiedCandidate, false);
  assert.ok(gate.reasons.includes("ENTRY_NOT_APPROVED"));
  assert.equal(gate.reasons.includes("ENTRY_SCORE_BELOW_75"), false);
});

test("F 70 with an approved entry and passing C X R S is buyable", () => {
  const decision = evaluateBuyable({
    authorizedDecisionValid: true,
    authorizedDecisionScore: 70,
    currentAnalyticalScore: 70,
    entryApproved: true,
    ...passingLayers,
  });
  assert.equal(decision.buyable, true);
  const now = new Date().toISOString();
  const gate = evaluateStockTradeCandidate({
    masterFinalScore: 70,
    stockDecisionScore: 70,
    stockDecisionScoreAvailable: true,
    entryQualityScore: 80,
    entryQualityScorecard: { approved: true, coverage: 1 },
    centralAutonomousAction: "ALLOW",
    spreadPercent: 0.2,
    liveQuoteUpdatedAt: now,
    spreadUpdatedAt: now,
    liveQuoteSource: "alpaca_latest_stock_quote",
    spreadSource: "alpaca_latest_stock_quote",
    priceIsLive: true,
  }, { requireCentralDecision: true });
  assert.equal(gate.approved, true);
  assert.equal(gate.qualifiedCandidate, true);
});

test("an exhausted setup cannot open a new long", () => {
  const classified = classifySetupState({ runnerStage: "EXHAUSTION", price: 12 });
  assert.equal(classified.state, "EXHAUSTED");
  assert.equal(classified.newLongEntryAllowed, false);
  assert.equal(setupEntryBlock({ setupState: "EXHAUSTED" }), "EXHAUSTION");
  const result = scoreEntryFamilies({
    ...bullish(),
    setupState: "EXHAUSTED",
    relativeVolume: 2,
    breakoutStructure: { clearedResistance: true, structureIntact: true },
  });
  assert.equal(result.newLongEntryAllowed, false);
  assert.equal(result.entryApproved, false);
});

test("a quote older than 5 seconds blocks execution and leaves F and E analytical", () => {
  const now = Date.parse("2026-09-25T14:00:00.000Z");
  const fresh = new Date(now).toISOString();
  const stale = new Date(now - 8000).toISOString();
  const shared = {
    masterFinalScore: 81,
    stockDecisionScore: 81,
    stockDecisionScoreAvailable: true,
    entryQualityScore: 82,
    entryQualityScorecard: { approved: true, coverage: 1, score: 82 },
    centralAutonomousAction: "ALLOW",
    spreadPercent: 0.2,
    liveQuoteSource: "alpaca_latest_stock_quote",
    spreadSource: "alpaca_latest_stock_quote",
    priceIsLive: true,
    decisionUpdatedAt: fresh,
  };
  const blocked = evaluateStockTradeCandidate({
    ...shared,
    liveQuoteUpdatedAt: stale,
    spreadUpdatedAt: stale,
  }, { requireCentralDecision: true, requireFreshDecision: true, now });
  assert.equal(blocked.finalScore, 81);
  assert.equal(blocked.entryScore, 82);
  assert.ok(blocked.reasons.includes("QUOTE_STALE"));
  assert.equal(blocked.approved, false);
  const entryBase = {
    confirmations: { aboveVwap: true, closeNearHighPercent: 82, fakeBreakout: false },
    technicals: { ema9: 11, ema20: 10, macd: 2, macdSignal: 1, rsi: 60 },
    phase5SignalQuality: { liquidityStabilityScore: 85, antiChaseRisk: 15, exhaustionRisk: 15, spreadWideningRisk: 10, breakoutRetestConfirmation: true },
    bid: 10,
    ask: 10.02,
    technicalBarsFound: 30,
  };
  const liveEntry = calculateEntryQualityScore({ ...entryBase, liveQuoteUpdatedAt: fresh });
  const staleEntry = calculateEntryQualityScore({ ...entryBase, liveQuoteUpdatedAt: stale });
  assert.equal(staleEntry.score, liveEntry.score);
  assert.ok(staleEntry.score > 0);
});

test("a spread above 1 percent blocks execution and does not collapse E or F", () => {
  const now = new Date().toISOString();
  const gate = evaluateStockTradeCandidate({
    masterFinalScore: 81,
    stockDecisionScore: 81,
    stockDecisionScoreAvailable: true,
    entryQualityScore: 82,
    entryQualityScorecard: { approved: true, coverage: 1, score: 82 },
    centralAutonomousAction: "ALLOW",
    spreadPercent: 1.4,
    bid: 10,
    ask: 10.14,
    liveQuoteUpdatedAt: now,
    spreadUpdatedAt: now,
    liveQuoteSource: "alpaca_latest_stock_quote",
    spreadSource: "alpaca_latest_stock_quote",
    priceIsLive: true,
  }, { requireCentralDecision: true });
  assert.equal(gate.finalScore, 81);
  assert.equal(gate.entryScore, 82);
  assert.ok(gate.reasons.includes("SPREAD_ABOVE_EXECUTION_LIMIT"));
  assert.equal(gate.approved, false);
  const entryBase = {
    confirmations: { aboveVwap: true, closeNearHighPercent: 82, fakeBreakout: false },
    technicals: { ema9: 11, ema20: 10, macd: 2, macdSignal: 1, rsi: 60 },
    phase5SignalQuality: { liquidityStabilityScore: 85, antiChaseRisk: 15, exhaustionRisk: 15, spreadWideningRisk: 10, breakoutRetestConfirmation: true },
    technicalBarsFound: 30,
  };
  const tight = calculateEntryQualityScore({ ...entryBase, bid: 10, ask: 10.02 });
  const wide = calculateEntryQualityScore({ ...entryBase, bid: 10, ask: 10.14 });
  assert.equal(wide.score, tight.score);
  assert.equal(wide.spreadTooWide, true);
  assert.ok(wide.score > 0);
});
