import test from "node:test";
import assert from "node:assert/strict";
import {
  CRYPTO_SETUP_DRIFT,
  STOCK_SETUP_DRIFT,
  evaluateSetupDrift,
  stockTickSize,
} from "../scoring/setupDrift.js";
import { reassessmentTrigger } from "../discovery/reassessmentTrigger.js";
import { installCentralDecision } from "../scoring/installCentralDecision.js";
import { revalidateCandidate } from "../scoring/revalidateCandidate.js";
import { buildStockDecisionScore, calculateEntryQualityScore } from "../scoring/decisionScores.js";

const now = Date.now();

function bars(price, count = 16, range = 0.04) {
  return Array.from({ length: count }, (_, index) => ({
    time: now - (count - index) * 300000,
    open: price,
    high: price + range / 2,
    low: price - range / 2,
    close: price,
  }));
}

function book(price, spread) {
  return { bid: price - spread / 2, ask: price + spread / 2 };
}

function stock(price = 100, extra = {}) {
  return {
    symbol: "AAPL",
    assetClass: "stock",
    chartTimeframe: "5Min",
    chartBars: bars(price),
    ...book(price, 0.02),
    decisionReferencePrice: price,
    decisionReferencePriceType: "NBBO_MID",
    decisionReferenceTimestamp: new Date(now).toISOString(),
    discoveryScore: 77,
    entryQualityScore: 80,
    stockDecisionScore: 78,
    currentAnalyticalScore: 78,
    authorizedDecisionScore: 78,
    masterFinalScore: 78,
    scoreVersion: 4,
    centralAutonomousDecisionCore: { action: "ALLOW" },
    ...extra,
  };
}

test("stock and crypto coefficients stay separate, and the stock tick is still one cent at or above $1", () => {
  assert.equal(STOCK_SETUP_DRIFT.atrMultiplier, 1);
  assert.equal(STOCK_SETUP_DRIFT.spreadMultiplier, 1.5);
  assert.equal(CRYPTO_SETUP_DRIFT.atrMultiplier, 1);
  assert.equal(CRYPTO_SETUP_DRIFT.spreadMultiplier, 1.5);
  assert.equal(STOCK_SETUP_DRIFT === CRYPTO_SETUP_DRIFT, false);
  assert.equal(CRYPTO_SETUP_DRIFT.tickSize, null);
  assert.equal(stockTickSize(100), 0.01);
  assert.equal(stockTickSize(0.5), 0.0001);
});

test("a temporarily wide quote does not widen the rescore distance", () => {
  const row = evaluateSetupDrift(stock(100, {
    ...book(100.1, 0.4),
    spreadReferenceSamples: [0.05, 0.05, 0.05, 0.05, 0.05],
  }), { now });
  assert.ok(row.rescoreDistance < 0.2);
  assert.equal(row.spreadReference, 0.05);
  assert.equal(row.rescoreStatus, "QUEUED");
  assert.equal(row.executionWaitReason, "SETUP_CHANGED_REASSESSMENT_PENDING");
});

test("a trade print is not compared with an NBBO midpoint", () => {
  const row = evaluateSetupDrift(stock(100, { price: 110, current: 110 }), { now });
  assert.equal(row.rescoreStatus, "NONE");
  assert.equal(row.setupDriftStatus, "WITHIN_BAND");
});

test("a missing book waits on the quote and does not queue a rescore", () => {
  const row = evaluateSetupDrift(stock(100, { bid: null, ask: null, price: null }), { now });
  assert.equal(row.rescoreStatus, "NONE");
  assert.equal(row.executionWaitReason, "QUOTE_UNAVAILABLE");
  assert.equal(row.evidenceWaitReason, null);
});

test("ATR is required before any spread-only rescore, and 2% is not the fallback", () => {
  const row = evaluateSetupDrift(stock(100, {
    chartBars: [],
    ...book(110, 0.02),
    spreadReferenceSamples: [0.02, 0.02, 0.02, 0.02, 0.02],
  }), { now });
  assert.equal(row.rescoreStatus, "NONE");
  assert.equal(row.setupDriftStatus, "WAIT_ATR");
  assert.equal(row.evidenceWaitReason, "PRICE_EVIDENCE_UNAVAILABLE");
  assert.equal(row.atrBackfillRequested, true);
  assert.equal(row.rescoreDistance, null);
});

test("the tick floor stops a one-tick move when ATR and the robust spread are smaller than two ticks", () => {
  const quiet = {
    chartBars: bars(100, 16, 0.0002),
    spreadReferenceSamples: [0.001, 0.001, 0.001, 0.001, 0.001],
  };
  const oneTick = evaluateSetupDrift(stock(100, { ...quiet, ...book(100.01, 0.001) }), { now });
  assert.equal(oneTick.tickFloor, 0.02);
  assert.equal(oneTick.rescoreStatus, "NONE");
  const pastFloor = evaluateSetupDrift(stock(100, { ...quiet, ...book(100.03, 0.001) }), { now });
  assert.equal(pastFloor.rescoreStatus, "QUEUED");
  assert.equal(pastFloor.rescoreReason, "SETUP_CHANGED");
});

test("a large bar does not rescore on a 3% move, and a quiet bar does rescore inside 2%", () => {
  const noisy = evaluateSetupDrift(stock(100, {
    chartBars: bars(100, 16, 10),
    ...book(103, 0.02),
    spreadReferenceSamples: [0.02, 0.02, 0.02, 0.02, 0.02],
  }), { now });
  assert.equal(noisy.rescoreStatus, "NONE");
  const quiet = evaluateSetupDrift(stock(100, {
    chartBars: bars(100, 16, 0.2),
    ...book(100.6, 0.02),
    spreadReferenceSamples: [0.02, 0.02, 0.02, 0.02, 0.02],
  }), { now });
  assert.equal(quiet.rescoreStatus, "QUEUED");
  assert.ok(quiet.driftAbs < 100 * 0.02);
});

test("a queued rescore latches one job and raises priority when the drift grows", () => {
  const first = evaluateSetupDrift(stock(100, {
    chartBars: bars(100, 16, 0.2),
    ...book(100.6, 0.02),
    spreadReferenceSamples: [0.02, 0.02, 0.02, 0.02, 0.02],
  }), { now });
  const second = evaluateSetupDrift({
    ...stock(100, { chartBars: bars(100, 16, 0.2), spreadReferenceSamples: first.spreadReferenceSamples }),
    ...first,
    ...book(102, 0.02),
  }, { now: now + 1000 });
  assert.equal(second.rescoreStatus, "QUEUED");
  assert.equal(second.rescoreTriggeredAt, first.rescoreTriggeredAt);
  assert.equal(second.reassessmentEvent, first.reassessmentEvent);
  assert.ok(second.maxDriftSinceTrigger > first.maxDriftSinceTrigger);
  assert.equal(second.reassessmentPriority, 3);
  const queued = reassessmentTrigger({ ...stock(100), ...first }, now + 1000);
  assert.equal(queued.rescoreStatus, first.rescoreStatus);
  assert.equal(queued.reassessmentEvent, first.reassessmentEvent);
});

test("revalidation keeps D, E, and F and blocks the entry while the rescore is queued", () => {
  const signal = stock(100, {
    chartBars: bars(100, 16, 0.2),
    spreadReferenceSamples: [0.02, 0.02, 0.02, 0.02, 0.02],
    approved: true,
    backendApproved: true,
    autoTradeApproved: true,
    qualifiedToBuy: true,
    finalApprovedTradeAmount: 100,
    priceIsLive: true,
    spreadAvailable: true,
    spreadPercent: 0.02,
    liveQuoteUpdatedAt: new Date(now).toISOString(),
    spreadUpdatedAt: new Date(now).toISOString(),
    liveQuoteSource: "tradier_stock_quote",
    spreadSource: "tradier_stock_quote",
    decisionUpdatedAt: new Date(now).toISOString(),
    technicalBarsFound: 60,
    technicals: { ema9: 100, ema20: 99, macd: 2, macdSignal: 1, rsi: 60 },
    confirmations: { aboveVwap: true, fakeBreakout: false, closeNearHighPercent: 95 },
    phase5SignalQuality: { liquidityStabilityScore: 90, antiChaseRisk: 10, breakoutRetestConfirmation: true },
    discoveryScorecard: { score: 77, coverage: 1, canonicalExtensionEvidencePass: true },
    contextScore: 80,
    riskPortfolioScore: 80,
    fundamentalScore: 80,
    fundamentalDataValid: true,
    decisionRevision: 2,
  });
  signal.entryQualityScorecard = calculateEntryQualityScore(signal);
  const evidence = buildStockDecisionScore(signal);
  installCentralDecision(signal, {
    decisionRevision: 3,
    action: "ALLOW",
    finalDecisionScore: evidence.score,
    stockDecisionEvidence: evidence,
  }, { now });
  const scored = {
    ...signal,
    discoveryScore: 77,
    entryQualityScore: 80,
    currentAnalyticalScore: signal.currentAnalyticalScore,
    authorizedDecisionScore: signal.authorizedDecisionScore,
  };
  const moved = revalidateCandidate(scored, {
    ...scored,
    ...book(scored.decisionReferencePrice + 0.6, 0.02),
    price: scored.decisionReferencePrice + 0.6,
  }, { now: now + 1000 });
  assert.equal(moved.discoveryScore, 77);
  assert.equal(moved.entryQualityScore, 80);
  assert.equal(moved.currentAnalyticalScore, scored.currentAnalyticalScore);
  assert.equal(moved.authorizedDecisionScore, scored.authorizedDecisionScore);
  assert.equal(moved.rescoreStatus, "QUEUED");
  assert.equal(moved.opportunityLayers.scoreIsStale, true);
  assert.equal(moved.opportunityLayers.F, scored.currentAnalyticalScore);
  assert.equal(moved.opportunityLayers.analytical.reasons.includes("SETUP_CHANGED"), true);
  assert.equal(moved.buyableNow, false);
  assert.equal(moved.finalApprovedTradeAmount, 0);
  assert.equal(moved.executionEligibility.reasons.includes("SETUP_PRICE_MOVED_RESCAN_REQUIRED"), false);
});

test("central install labels the move and replaces the reference with a new midpoint", () => {
  const signal = stock(100, {
    rescoreStatus: "QUEUED",
    rescoreReason: "SETUP_CHANGED",
    confirmations: { fakeBreakout: true },
    decisionRevision: 1,
  });
  installCentralDecision(signal, {
    decisionRevision: 2,
    action: "BLOCK",
    finalDecisionScore: 78,
    stockDecisionEvidence: { analysisEvidencePass: true, coreEvidencePass: true },
  }, { now });
  assert.equal(signal.setupReviewOutcome, "BROKEN_SETUP");
  assert.equal(signal.rescoreStatus, "NONE");
  assert.equal(signal.decisionReferencePriceType, "NBBO_MID");
  assert.equal(signal.decisionReferencePrice, 100);

  const better = stock(100, {
    ...book(99, 0.02),
    rescoreStatus: "QUEUED",
    decisionRevision: 3,
    confirmations: { fakeBreakout: false },
  });
  installCentralDecision(better, {
    decisionRevision: 4,
    action: "ALLOW",
    finalDecisionScore: 78,
    stockDecisionEvidence: { analysisEvidencePass: true, coreEvidencePass: true },
  }, { now });
  assert.equal(better.setupReviewOutcome, "BETTER_ENTRY");
  assert.equal(better.rescoreStatus, "NONE");
});
