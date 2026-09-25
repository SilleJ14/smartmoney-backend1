import test from "node:test";
import assert from "node:assert/strict";
import { assessShareVolume, liquidityFromShareVolume } from "../scoring/evidenceState.js";
import { calculateCryptoSignalRealism } from "../scoring/cryptoScoring.js";
import { calculateEntryQualityScore } from "../scoring/decisionScores.js";
import { buildStockOpportunityLayers } from "../scoring/opportunityLayers.js";
import { applyAnalyticalScoreUpdate } from "../scoring/analyticalAuthorization.js";

const freshBook = {
  quoteAgeSeconds: 1,
  quoteSourceApproved: true,
  quoteFreshnessPass: true,
  spreadAvailable: true,
  spreadTooWide: false,
  spreadAgeSeconds: 1,
  spreadSourceApproved: true,
  spreadFreshnessPass: true,
};

const approvedEntry = {
  entryQualityScore: 82,
  entryQualityScorecard: { approved: true, score: 82, coverage: 1 },
};

test("missing volume stays unavailable and does not hard-reject", () => {
  const missing = assessShareVolume({});
  assert.equal(missing.state, "DATA_UNAVAILABLE");
  assert.equal(missing.value, null);
  assert.notEqual(missing.value, 0);
  const liquidity = liquidityFromShareVolume(missing, { minimumShares: 1000 });
  assert.equal(liquidity.hardReject, false);
  assert.equal(liquidity.liquidityStabilityScore, null);
  assert.equal(liquidity.state, "DATA_UNAVAILABLE");
});

test("measured zero volume is real poor liquidity", () => {
  const measured = assessShareVolume({ volume: 0, volumeSource: "tradier" });
  assert.equal(measured.measured, true);
  assert.equal(measured.value, 0);
  assert.equal(measured.state, "REJECT");
  const liquidity = liquidityFromShareVolume(measured, { minimumShares: 1000, dollarVolume: 0 });
  assert.equal(liquidity.hardReject, true);
  assert.equal(liquidity.state, "REJECT");
});

test("six crypto bars are unavailable and do not subtract a coverage penalty", () => {
  const result = calculateCryptoSignalRealism({
    symbol: "SOL/USD",
    rawCryptoScore: 80,
    current: 100,
    bid: 99.98,
    ask: 100.02,
    spreadAvailable: true,
    barsFound: 6,
    windowDollarVolume: 5_000_000,
    percentChange: 1,
  });
  assert.equal(result.barHistoryState, "DATA_UNAVAILABLE");
  assert.equal(result.technicalScore, null);
  assert.equal(result.penaltyComponents.find((item) => item.family === "dataCoverage").points, 0);
  assert.equal(result.realismScore, 80);
  assert.ok(result.missingComponents.includes("barHistory"));
});

test("enough crypto bars keep a measured weak execution penalty", () => {
  const result = calculateCryptoSignalRealism({
    symbol: "SOL/USD",
    rawCryptoScore: 80,
    current: 100,
    bid: 99,
    ask: 100,
    spreadAvailable: true,
    spreadPercent: 1,
    barsFound: 30,
    windowDollarVolume: 5_000_000,
    percentChange: 1,
  });
  assert.equal(result.barHistoryState, "PASS");
  assert.ok(result.realismScore < 80);
  assert.ok(result.cryptoRiskPenalty > 0);
});

test("a quote that never arrived is unavailable on execution", () => {
  const layers = buildStockOpportunityLayers({
    ...approvedEntry,
    currentAnalyticalScore: 80,
  }, {
    eligibility: { ...freshBook, quoteAgeSeconds: null, quoteFreshnessPass: false },
  });
  assert.equal(layers.X.state, "DATA_UNAVAILABLE");
  assert.ok(layers.X.reasons.includes("QUOTE_FRESHNESS_UNAVAILABLE"));
  assert.equal(layers.F, 80);
});

test("a previously valid quote that is now stale waits on execution", () => {
  const layers = buildStockOpportunityLayers({
    ...approvedEntry,
    currentAnalyticalScore: 80,
  }, {
    eligibility: { ...freshBook, quoteAgeSeconds: 9, quoteFreshnessPass: false },
  });
  assert.equal(layers.X.state, "EXECUTION_NOT_READY");
  assert.ok(layers.X.reasons.includes("QUOTE_STALE"));
  assert.equal(layers.F, 80);
  assert.equal(layers.E, 82);
});

test("a measured 1.2 percent spread rejects execution and leaves F and E", () => {
  const signal = { ...approvedEntry, currentAnalyticalScore: 81, stockDecisionScore: 81 };
  const open = buildStockOpportunityLayers(signal, { eligibility: freshBook });
  const wide = buildStockOpportunityLayers(signal, { eligibility: { ...freshBook, spreadTooWide: true } });
  assert.equal(wide.X.state, "EXECUTION_NOT_READY");
  assert.ok(wide.X.reasons.includes("SPREAD_ABOVE_EXECUTION_LIMIT"));
  assert.equal(wide.F, open.F);
  assert.equal(wide.E, open.E);
  assert.equal(wide.analyticalPass, open.analyticalPass);
});

test("a confirmed negative article rejects the evidence layer and can cap Entry", () => {
  const entry = calculateEntryQualityScore({
    confirmations: { aboveVwap: true, closeNearHighPercent: 90, fakeBreakout: false, newsRisk: true, newsRiskAvailable: true },
    technicals: { ema9: 11, ema20: 10, macd: 2, macdSignal: 1, rsi: 60 },
    technicalBarsFound: 30,
    bid: 10,
    ask: 10.01,
    phase5SignalQuality: { liquidityStabilityScore: 90, antiChaseRisk: 10, exhaustionRisk: 10, breakoutRetestConfirmation: true },
  });
  assert.ok(entry.score <= 35);
  const layers = buildStockOpportunityLayers({
    ...approvedEntry,
    currentAnalyticalScore: 80,
    requireNewsRiskForEntry: true,
    confirmations: { newsRisk: true, newsRiskAvailable: true },
  }, { eligibility: freshBook });
  assert.equal(layers.C.state, "REJECT");
  assert.ok(layers.C.reasons.includes("NEGATIVE_CATALYST"));
  assert.equal(layers.F, 80);
});

test("an unavailable news provider does not cap Entry", () => {
  const entry = calculateEntryQualityScore({
    requireNewsRiskForEntry: true,
    confirmations: { aboveVwap: true, closeNearHighPercent: 90, fakeBreakout: false, newsRiskAvailable: false },
    technicals: { ema9: 11, ema20: 10, macd: 2, macdSignal: 1, rsi: 60 },
    technicalBarsFound: 30,
    bid: 10,
    ask: 10.01,
    phase5SignalQuality: { liquidityStabilityScore: 90, antiChaseRisk: 10, exhaustionRisk: 10, breakoutRetestConfirmation: true },
  });
  assert.ok(entry.score > 35);
  const layers = buildStockOpportunityLayers({
    ...approvedEntry,
    currentAnalyticalScore: 80,
    requireNewsRiskForEntry: true,
    newsProviderStatus: "down",
  }, { eligibility: freshBook });
  assert.equal(layers.C.state, "WAIT");
  assert.ok(layers.C.reasons.includes("NEWS_PROVIDER_UNAVAILABLE"));
  assert.equal(layers.F, 80);
});

test("setup drift keeps the last F and marks it stale", () => {
  const layers = buildStockOpportunityLayers({
    ...approvedEntry,
    currentAnalyticalScore: 78,
    rescoreStatus: "QUEUED",
    rescoreReason: "SETUP_CHANGED",
  }, { eligibility: freshBook });
  assert.equal(layers.analyticalState, "RESCORE_REQUIRED");
  assert.equal(layers.scoreIsStale, true);
  assert.equal(layers.F, 78);
  assert.equal(layers.currentAnalyticalScore, 78);
  assert.equal(layers.analyticalPass, false);
});

test("a running central review waits and does not change F", () => {
  const layers = buildStockOpportunityLayers({
    ...approvedEntry,
    currentAnalyticalScore: 81,
    centralReviewStatus: "RUNNING",
  }, { eligibility: freshBook });
  assert.equal(layers.authorization.state, "WAIT");
  assert.ok(layers.authorization.reasons.includes("CENTRAL_REVIEW_RUNNING"));
  assert.equal(layers.F, 81);
  assert.equal(layers.analyticalPass, true);
});

test("provider recovery with the same score is not an analytical improvement", () => {
  const update = applyAnalyticalScoreUpdate({
    currentAnalyticalScore: 78,
    authorizedDecisionValid: true,
    authorizedDecisionScore: 78,
    centralReviewStatus: "NONE",
  }, 78, { scoreChangeCause: "EVIDENCE_RECOVERED" });
  assert.equal(update.currentAnalyticalScore, 78);
  assert.equal(update.analyticalImprovement, false);
  assert.equal(update.centralReviewStatus, "NONE");
  assert.notEqual(update.reviewTrigger, "THRESHOLD_CROSS");
});

test("evidence and execution keep independent states at the same time", () => {
  const layers = buildStockOpportunityLayers({
    ...approvedEntry,
    currentAnalyticalScore: 80,
    requireNewsRiskForEntry: true,
    confirmations: { newsRiskAvailable: false },
  }, { eligibility: { ...freshBook, spreadTooWide: true } });
  assert.equal(layers.C.state, "DATA_UNAVAILABLE");
  assert.equal(layers.X.state, "EXECUTION_NOT_READY");
  assert.equal(layers.R.state, "PASS");
  assert.equal(layers.F, 80);
  assert.ok(layers.C.reasons.includes("NEWS_UNKNOWN"));
  assert.ok(layers.X.reasons.includes("SPREAD_ABOVE_EXECUTION_LIMIT"));
});

test("unavailable evidence is not stored as zero unless the provider measured zero", () => {
  assert.equal(assessShareVolume({ volume: null }).value, null);
  assert.equal(assessShareVolume({ volume: undefined }).value, null);
  assert.equal(assessShareVolume({ volumeAvailable: false, volume: 0 }).value, null);
  assert.equal(assessShareVolume({ volume: 0 }).value, 0);
  const entry = calculateEntryQualityScore({
    confirmations: { aboveVwap: true, closeNearHighPercent: 80, fakeBreakout: false },
    technicals: { ema9: 11, ema20: 10, macd: 1, macdSignal: 0.2, rsi: 55 },
    technicalBarsFound: 8,
    bid: 10,
    ask: 10.01,
    phase5SignalQuality: { liquidityStabilityScore: 80, antiChaseRisk: 10, exhaustionRisk: 10, breakoutRetestConfirmation: true },
  });
  const trend = entry.components.find((item) => item.name === "trendAlignment");
  assert.equal(trend.value, null);
  assert.equal(trend.available, false);
});
