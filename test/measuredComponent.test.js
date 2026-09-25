import test from "node:test";
import assert from "node:assert/strict";
import {
  aggregateMeasuredComponents,
  buildMeasuredComponent,
  classifyScoreChange,
  evaluateEvidencePolicy,
  STOCK_DECISION_EVIDENCE_POLICY,
  CRYPTO_DECISION_EVIDENCE_POLICY,
} from "../scoring/measuredComponent.js";
import { buildStockDecisionScore, calculateEntryQualityScore } from "../scoring/decisionScores.js";
import { applyAnalyticalScoreUpdate, evaluateBuyable } from "../scoring/analyticalAuthorization.js";
import { buildStockOpportunityLayers } from "../scoring/opportunityLayers.js";
import { buildCryptoDecisionScore } from "../scoring/componentScore.js";
import { calculateInstitutionalRiskScore } from "../scoring/riskScores.js";
import { evidencePriority } from "../discovery/evidencePriority.js";

const clampScore = (value) => Math.max(0, Math.min(100, Number(value) || 0));

function stockComponent(name, score, weight, coverage = score === null ? 0 : 1) {
  return buildMeasuredComponent({
    componentName: name,
    score,
    coverage,
    configuredWeight: weight,
    minimumCoverage: name === "riskPortfolio" ? 0.6 : 0.5,
  });
}

const measuredBook = {
  discoveryScorecard: { score: 80, buyScore: 80, coverage: 1, canonicalExtensionEvidencePass: true },
  entryQualityScorecard: { score: 80, coverage: 1, approved: true },
  contextScore: 70,
  riskPortfolioScore: 70,
};

test("missing fundamentals renormalizes F and lowers coverage", () => {
  const decision = buildStockDecisionScore({ ...measuredBook, fundamentalDataValid: false });
  const fundamentals = decision.components.find((item) => item.name === "fundamentals");
  assert.equal(fundamentals.value, null);
  assert.equal(fundamentals.contribution, 0);
  assert.equal(decision.score, 78.04);
  assert.equal(decision.coverage, 0.92);
  assert.equal(decision.evidenceBasis.fundamentals, "UNKNOWN");
  assert.equal(decision.evidenceBasis.discovery, "PRESENT");
});

test("fundamentals measured at 0 remain 0 and lower F", () => {
  const decision = buildStockDecisionScore({
    ...measuredBook,
    fundamentalBlendScore: 0,
    fundamentalDataValid: true,
  });
  const fundamentals = decision.components.find((item) => item.name === "fundamentals");
  assert.equal(fundamentals.value, 0);
  assert.equal(fundamentals.available, true);
  assert.equal(decision.score, 71.8);
  assert.ok(decision.score < 78.04);
});

test("a disappeared weak fundamental is evidence loss, not a threshold cross", () => {
  const before = buildStockDecisionScore({
    ...measuredBook,
    fundamentalBlendScore: 30,
    fundamentalDataValid: true,
  });
  const after = buildStockDecisionScore({ ...measuredBook, fundamentalDataValid: false });
  assert.equal(before.score, 74.2);
  assert.equal(after.score, 78.04);
  const cause = classifyScoreChange({
    previousBasis: before.evidenceBasis,
    nextBasis: after.evidenceBasis,
    previousScore: before.score,
    nextScore: after.score,
    previousCoverage: before.coverage,
    nextCoverage: after.coverage,
  });
  assert.equal(cause, "EVIDENCE_LOST");
  const update = applyAnalyticalScoreUpdate({
    currentAnalyticalScore: before.score,
    authorizedDecisionValid: false,
    evidenceBasis: before.evidenceBasis,
    decisionCoverage: before.coverage,
  }, after.score, { scoreChangeCause: cause, evidenceBasis: after.evidenceBasis, coverage: after.coverage });
  assert.notEqual(update.reviewTrigger, "THRESHOLD_CROSS");
  assert.equal(update.scoreRiseReason, "SCORE_RISE_FROM_EVIDENCE_LOSS");
  assert.equal(update.analyticalImprovement, false);
  assert.equal(update.scoreVelocity, 0);
});

test("restored fundamentals put the measured 30 back into F", () => {
  const missing = buildStockDecisionScore({ ...measuredBook, fundamentalDataValid: false });
  const restored = buildStockDecisionScore({
    ...measuredBook,
    fundamentalBlendScore: 30,
    fundamentalDataValid: true,
  });
  assert.equal(restored.score, 74.2);
  assert.equal(restored.coverage, 1);
  assert.ok(restored.score < missing.score);
  assert.equal(classifyScoreChange({
    previousBasis: missing.evidenceBasis,
    nextBasis: restored.evidenceBasis,
    previousScore: missing.score,
    nextScore: restored.score,
    previousCoverage: missing.coverage,
    nextCoverage: restored.coverage,
  }), "EVIDENCE_RECOVERED");
});

test("unread required news does not cap entry at 35", () => {
  const entry = calculateEntryQualityScore({
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
  });
  assert.equal(entry.newsEvidence, "UNKNOWN");
  assert.equal(entry.gates.includes("NEWS_UNKNOWN"), true);
  assert.equal(entry.gates.includes("HARD_RISK_REJECT"), false);
  assert.ok(entry.score > 35);
  assert.equal(entry.approved, true);
});

test("confirmed negative news still blocks the entry", () => {
  const entry = calculateEntryQualityScore({
    confirmations: { aboveVwap: true, closeNearHighPercent: 85, fakeBreakout: false, newsRisk: true },
    bid: 10,
    ask: 10.01,
    technicalBarsFound: 30,
    technicals: { ema9: 11, ema20: 10, macd: 2, macdSignal: 1, rsi: 60 },
    phase5SignalQuality: { liquidityStabilityScore: 90, antiChaseRisk: 10, exhaustionRisk: 10, spreadWideningRisk: 10 },
  });
  assert.equal(entry.newsEvidence, "NEGATIVE");
  assert.equal(entry.approved, false);
  assert.ok(entry.score <= 35);
});

test("missing bid and ask leaves spread unknown and execution waiting", () => {
  const entry = calculateEntryQualityScore({
    confirmations: { aboveVwap: true, closeNearHighPercent: 82, fakeBreakout: false },
    technicals: { ema9: 11, ema20: 10, macd: 2, macdSignal: 1, rsi: 60 },
    technicalBarsFound: 30,
    phase5SignalQuality: { liquidityStabilityScore: 85, antiChaseRisk: 15, exhaustionRisk: 15, spreadWideningRisk: 10, breakoutRetestConfirmation: true },
  });
  assert.equal(entry.spreadQualityScore, null);
  assert.equal(entry.spreadPercent, null);
  const layers = buildStockOpportunityLayers({
    entryQualityScorecard: entry,
    bookAvailable: false,
    currentAnalyticalScore: 78,
    stockDecisionScore: 78,
  }, {
    eligibility: { spreadAvailable: false, quoteAgeSeconds: 1, quoteSourceApproved: true, quoteFreshnessPass: true },
  });
  assert.equal(layers.X.state, "DATA_UNAVAILABLE");
  assert.equal(layers.X.reasons.includes("BOOK_UNAVAILABLE"), true);
});

test("a measured terrible spread can score 0", () => {
  const entry = calculateEntryQualityScore({
    confirmations: { aboveVwap: true, closeNearHighPercent: 82, fakeBreakout: false },
    technicals: { ema9: 11, ema20: 10, macd: 2, macdSignal: 1, rsi: 60 },
    technicalBarsFound: 30,
    bid: 10,
    ask: 10.5,
    phase5SignalQuality: { liquidityStabilityScore: 85, antiChaseRisk: 15, exhaustionRisk: 15, spreadWideningRisk: 10, breakoutRetestConfirmation: true },
  });
  assert.equal(entry.spreadQualityScore, 0);
  assert.equal(entry.spreadTooWide, true);
});

test("missing EMA and MACD do not create a bearish trend score", () => {
  const entry = calculateEntryQualityScore({
    confirmations: { aboveVwap: true, closeNearHighPercent: 82, fakeBreakout: false },
    technicalBarsFound: 30,
    bid: 10,
    ask: 10.01,
    phase5SignalQuality: { liquidityStabilityScore: 85, antiChaseRisk: 15, exhaustionRisk: 15, spreadWideningRisk: 10, breakoutRetestConfirmation: true },
  });
  const trend = entry.components.find((item) => item.name === "trendAlignment");
  assert.equal(trend.available, false);
  assert.equal(trend.value, null);
  assert.equal(entry.missingComponents.includes("trendAlignment"), true);
  assert.equal(entry.gates.includes("HARD_RISK_REJECT"), false);
});

test("risk coverage records missing volume, VWAP, and RSI instead of inventing them", () => {
  const risk = calculateInstitutionalRiskScore({
    technicals: { rsi: 55 },
  }, { clampScore });
  assert.equal(risk.institutionalRiskScore, null);
  assert.equal(risk.riskPublishable, false);
  assert.equal(risk.riskCoverage, 0.2);
  assert.equal(risk.missingInputs.includes("VOLUME"), true);
  assert.equal(risk.missingInputs.includes("VWAP"), true);
  assert.equal(risk.measuredInputs.includes("RSI"), true);
  assert.equal(risk.liquidityStressScore, null);
});

test("crypto with unread context keeps F at the measured 90 and coverage 0.85", () => {
  const analytical = aggregateMeasuredComponents([
    buildMeasuredComponent({ componentName: "base", score: 90, coverage: 1, configuredWeight: 0.45, minimumCoverage: 0.5 }),
    buildMeasuredComponent({ componentName: "execution", score: 90, coverage: 1, configuredWeight: 0.4, minimumCoverage: 0.5 }),
    buildMeasuredComponent({ componentName: "strategyEvolution", score: null, coverage: 0, configuredWeight: 0.15, minimumCoverage: 0.5 }),
  ]);
  assert.equal(analytical.score, 90);
  assert.equal(analytical.coverage, 0.85);
  const now = Date.parse("2026-08-30T12:00:00.000Z");
  const decision = buildCryptoDecisionScore({
    symbol: "BTC/USD",
    cryptoDiscoveryScorecard: {
      stage: "CRYPTO_EARLY_DISCOVERY",
      score: 90,
      coverage: 1,
      calculatedAt: new Date(now).toISOString(),
      extension: { alreadyExtended: false },
    },
    newsCatalyst: { dataAvailable: true, riskDetected: false },
    barsFound: 30,
    current: 100,
    priceIsLive: true,
    liveQuoteUpdatedAt: new Date(now).toISOString(),
    liveQuoteSource: "alpaca_crypto_latest",
    spreadUpdatedAt: new Date(now).toISOString(),
    spreadSource: "alpaca_crypto_latest",
    bid: 99.95,
    ask: 100.05,
    windowDollarVolume: 1_000_000,
  }, { now });
  const execution = decision.componentsByName.execution.value;
  assert.equal(decision.score, Number(((90 * 0.45 + execution * 0.4) / 0.85).toFixed(2)));
  assert.equal(decision.coverage, 0.85);
  assert.equal(decision.componentsByName.strategyEvolution.value, null);
  assert.equal(decision.componentsByName.strategyEvolution.contribution, 0);
  assert.equal(decision.evidenceBasis.strategyEvolution, "UNKNOWN");
  const optionalContext = evaluateEvidencePolicy(decision.evidenceBasis, CRYPTO_DECISION_EVIDENCE_POLICY);
  assert.equal(optionalContext.state, "PASS");
  const requiredContext = evaluateEvidencePolicy(decision.evidenceBasis, {
    ...CRYPTO_DECISION_EVIDENCE_POLICY,
    strategyEvolution: "REQUIRED",
  });
  assert.equal(requiredContext.state, "DATA_UNAVAILABLE");
  assert.equal(requiredContext.reasons.includes("CONTEXT_UNKNOWN"), true);
});

test("the same measured evidence produces the same F during an unrelated outage", () => {
  const first = buildStockDecisionScore(measuredBook);
  const second = buildStockDecisionScore({
    ...measuredBook,
    unrelatedProviderOutage: true,
    newsProviderStatus: "down",
  });
  assert.equal(first.score, second.score);
  assert.equal(first.coverage, second.coverage);
  assert.equal(first.evidenceBasisVersion, second.evidenceBasisVersion);
});

test("a rise from 68 to 72 caused by losing evidence does not cross the buy gate", () => {
  const full = aggregateMeasuredComponents([
    stockComponent("discovery", 72, 0.8, 1),
    stockComponent("weak", 52, 0.2, 1),
  ]);
  const lost = aggregateMeasuredComponents([
    stockComponent("discovery", 72, 0.8, 1),
    stockComponent("weak", null, 0.2, 0),
  ]);
  assert.equal(full.score, 68);
  assert.equal(full.coverage, 1);
  assert.equal(lost.score, 72);
  assert.equal(lost.coverage, 0.8);
  const cause = classifyScoreChange({
    previousBasis: full.evidenceBasis,
    nextBasis: lost.evidenceBasis,
    previousScore: full.score,
    nextScore: lost.score,
    previousCoverage: full.coverage,
    nextCoverage: lost.coverage,
  });
  assert.equal(cause, "EVIDENCE_LOST");
  const update = applyAnalyticalScoreUpdate({
    currentAnalyticalScore: 68,
    authorizedDecisionValid: false,
    centralReviewStatus: "NONE",
  }, 72, { scoreChangeCause: cause });
  assert.equal(update.centralReviewStatus, "NONE");
  assert.notEqual(update.reviewTrigger, "THRESHOLD_CROSS");
  assert.equal(update.scoreRiseReason, "SCORE_RISE_FROM_EVIDENCE_LOSS");
});

test("unknown fundamentals wait in C while F stays at the measured score", () => {
  const decision = buildStockDecisionScore({ ...measuredBook, fundamentalDataValid: false });
  const layers = buildStockOpportunityLayers({
    evidenceBasis: decision.evidenceBasis,
    currentAnalyticalScore: decision.score,
    stockDecisionScore: decision.score,
    discoveryScore: 80,
    entryQualityScore: 80,
  });
  assert.equal(decision.score, 78.04);
  assert.equal(layers.C.state, "DATA_UNAVAILABLE");
  assert.equal(layers.C.reasons.includes("FUNDAMENTALS_UNKNOWN"), true);
  const buyable = evaluateBuyable({
    authorizedDecisionValid: true,
    authorizedDecisionScore: 80,
    currentAnalyticalScore: decision.score,
    C: layers.C.state,
    X: "PASS",
    R: "PASS",
    S: 100,
    cReason: layers.C.reasons[0],
  });
  assert.equal(buyable.buyable, false);
  assert.equal(buyable.reason, "FUNDAMENTALS_UNKNOWN");
});

test("equal F with thinner coverage gets evidence-acquisition priority", () => {
  const certain = evidencePriority({ symbol: "A", discoveryScore: 80, currentAnalyticalScore: 79, decisionCoverage: 1, maximumPossibleF: 79 });
  const thin = evidencePriority({ symbol: "B", discoveryScore: 80, currentAnalyticalScore: 79, decisionCoverage: 0.51, maximumPossibleF: 90 });
  assert.ok(thin.priority > certain.priority);
  assert.equal(thin.reasons.includes("EVIDENCE_ACQUISITION"), true);
});

test("half of a component does not receive that component's full weight", () => {
  const full = aggregateMeasuredComponents([
    stockComponent("riskPortfolio", 95, 0.09, 1),
  ]);
  const partial = aggregateMeasuredComponents([
    buildMeasuredComponent({
      componentName: "riskPortfolio",
      score: 95,
      coverage: 0.2,
      configuredWeight: 0.09,
      minimumCoverage: 0.6,
    }),
  ]);
  assert.equal(full.score, 95);
  assert.equal(full.coverage, 1);
  assert.equal(partial.score, null);
  assert.equal(partial.components[0].componentPublishable, false);
  assert.equal(partial.components[0].measuredWeight, 0);
});
