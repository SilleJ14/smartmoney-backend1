import test from "node:test";
import assert from "node:assert/strict";
import {
  applyAnalyticalScoreUpdate,
  assertAuthorizationUnchanged,
  authorizationFingerprint,
  completeCentralReview,
  evaluateBuyable,
} from "../scoring/analyticalAuthorization.js";
import { installCentralDecision } from "../scoring/installCentralDecision.js";
import { revalidateCandidate } from "../scoring/revalidateCandidate.js";
import { buildStockDecisionScore, calculateEntryQualityScore } from "../scoring/decisionScores.js";

const passing = { C: "PASS", X: "PASS", R: "PASS", S: 100 };

function authorized(score, extra = {}) {
  return {
    currentAnalyticalScore: score,
    authorizedDecisionScore: score,
    authorizedDecisionValid: true,
    scoreVersion: 17,
    centralReviewStatus: "NONE",
    centralAutonomousDecisionCore: { action: "ALLOW" },
    finalApprovedTradeAmount: 100,
    ...extra,
  };
}

test("68 to 69 stays below the line and does not request review", () => {
  const next = applyAnalyticalScoreUpdate(authorized(68, { authorizedDecisionValid: false, authorizedDecisionScore: 68 }), 69);
  assert.equal(next.currentAnalyticalScore, 69);
  assert.equal(next.authorizedDecisionScore, 68);
  assert.equal(next.centralReviewStatus, "NONE");
  assert.equal(next.reviewTrigger, null);
  assert.equal(next.scoreVersion, 17);
  const decision = evaluateBuyable({ ...next, ...passing });
  assert.equal(decision.buyable, false);
  assert.equal(decision.reason, "CURRENT_ANALYTICAL_SCORE_BELOW_THRESHOLD");
});

test("68 to 72 crosses the buy gate and requests central reauthorization", () => {
  const queued = applyAnalyticalScoreUpdate(authorized(68), 72);
  assert.equal(queued.currentAnalyticalScore, 72);
  assert.equal(queued.authorizedDecisionScore, 68);
  assert.equal(queued.centralReviewStatus, "QUEUED");
  assert.equal(queued.reviewTrigger, "THRESHOLD_CROSS");
  assert.equal(queued.scoreVersion, 17);
  const waiting = evaluateBuyable({ ...queued, ...passing });
  assert.equal(waiting.buyable, false);
  assert.equal(waiting.reason, "CENTRAL_REAUTHORIZATION_REQUIRED");
});

test("68 to 74 queues a threshold cross and stays unbuyable until central review", () => {
  const queued = applyAnalyticalScoreUpdate(authorized(68), 74);
  assert.equal(queued.currentAnalyticalScore, 74);
  assert.equal(queued.authorizedDecisionScore, 68);
  assert.equal(queued.centralReviewStatus, "QUEUED");
  assert.equal(queued.reviewTrigger, "THRESHOLD_CROSS");
  assert.equal(queued.scoreVersion, 17);
  const waiting = evaluateBuyable({ ...queued, ...passing });
  assert.equal(waiting.buyable, false);
  assert.equal(waiting.reason, "CENTRAL_REAUTHORIZATION_REQUIRED");

  const completed = completeCentralReview({ ...authorized(68), ...queued }, 74);
  assert.equal(completed.currentAnalyticalScore, 74);
  assert.equal(completed.authorizedDecisionScore, 74);
  assert.equal(completed.scoreVersion, 18);
  assert.equal(completed.centralReviewStatus, "NONE");
  assert.equal(completed.lastReviewResult, "COMPLETED");
  assert.equal(typeof completed.lastReviewCompletedAt, "string");
  assert.equal(evaluateBuyable({ ...completed, ...passing }).buyable, true);
});

test("80 to 83 keeps the authorized score and can stay buyable", () => {
  const next = applyAnalyticalScoreUpdate(authorized(80), 83);
  assert.equal(next.currentAnalyticalScore, 83);
  assert.equal(next.authorizedDecisionScore, 80);
  assert.equal(next.authorizedDecisionValid, true);
  assert.equal(next.centralReviewStatus, "NONE");
  assert.equal(next.reviewTrigger, null);
  assert.equal(next.scoreVersion, 17);
  assert.equal(evaluateBuyable({ ...next, ...passing }).buyable, true);
});

test("82 to 68 revokes buyable immediately and keeps the authorized score", () => {
  const next = applyAnalyticalScoreUpdate(authorized(82), 68);
  assert.equal(next.currentAnalyticalScore, 68);
  assert.equal(next.authorizedDecisionScore, 82);
  assert.equal(next.centralReviewStatus, "NONE");
  assert.equal(next.scoreVersion, 17);
  const decision = evaluateBuyable({ ...next, ...passing });
  assert.equal(decision.buyable, false);
  assert.equal(decision.reason, "CURRENT_ANALYTICAL_SCORE_BELOW_THRESHOLD");
});

test("a changed score, layer, or size fails the order recheck", () => {
  const before = authorizationFingerprint({
    ...authorized(80),
    currentAnalyticalScore: 83,
    opportunityLayers: {
      C: { state: "PASS" },
      X: { state: "PASS" },
      R: { state: "PASS" },
      S: { amount: 100 },
    },
  });
  assert.doesNotThrow(() => assertAuthorizationUnchanged(before, { ...before }));
  assert.throws(
    () => assertAuthorizationUnchanged(before, { ...before, currentAnalyticalScore: 68 }),
    /ORDER_REVALIDATION_FAILED/
  );
  assert.throws(
    () => assertAuthorizationUnchanged(before, { ...before, X: "WAIT" }),
    /ORDER_REVALIDATION_FAILED/
  );
});

test("central install writes both scores and a new version", () => {
  const signal = {
    ...authorized(68),
    currentAnalyticalScore: 74,
    centralReviewStatus: "QUEUED",
    reviewTrigger: "THRESHOLD_CROSS",
    decisionRevision: 4,
    stockDecisionEvidence: { analysisEvidencePass: true, coreEvidencePass: true },
  };
  installCentralDecision(signal, {
    decisionRevision: 5,
    action: "ALLOW",
    finalDecisionScore: 74,
    stockDecisionEvidence: { analysisEvidencePass: true, coreEvidencePass: true },
  });
  assert.equal(signal.currentAnalyticalScore, 74);
  assert.equal(signal.authorizedDecisionScore, 74);
  assert.equal(signal.masterFinalScore, 74);
  assert.equal(signal.stockDecisionScore, 74);
  assert.equal(signal.scoreVersion, 18);
  assert.equal(signal.centralReviewStatus, "NONE");
  assert.equal(signal.lastReviewResult, "COMPLETED");
  assert.equal(signal.authorizedDecisionValid, true);
});

test("a quote refresh can raise the analytical score without moving the authorized score", () => {
  const time = new Date().toISOString();
  const signal = {
    symbol: "AAPL",
    price: 100,
    bid: 99.99,
    ask: 100.01,
    spreadAvailable: true,
    liveQuoteUpdatedAt: time,
    spreadUpdatedAt: time,
    liveQuoteSource: "tradier_stock_quote",
    spreadSource: "tradier_stock_quote",
    priceIsLive: true,
    technicalBarsFound: 60,
    discoveryScorecard: { score: 80, coverage: 1, canonicalExtensionEvidencePass: true },
    contextScore: 80,
    riskPortfolioScore: 80,
    fundamentalScore: 80,
    fundamentalDataValid: true,
    confirmations: { aboveVwap: true, fakeBreakout: false, closeNearHighPercent: 95 },
    technicals: { ema9: 100, ema20: 99, macd: 2, macdSignal: 1, rsi: 60 },
    phase5SignalQuality: { liquidityStabilityScore: 90, antiChaseRisk: 10, breakoutRetestConfirmation: true },
    approved: true,
    backendApproved: true,
    autoTradeApproved: true,
    qualifiedToBuy: true,
    finalApprovedTradeAmount: 100,
    decisionRevision: 3,
  };
  signal.entryQualityScorecard = calculateEntryQualityScore(signal);
  const evidence = buildStockDecisionScore(signal);
  installCentralDecision(signal, {
    decisionRevision: 4,
    action: "ALLOW",
    finalDecisionScore: evidence.score,
    stockDecisionEvidence: evidence,
  });
  const authorizedScore = signal.authorizedDecisionScore;
  const version = signal.scoreVersion;
  signal.discoveryScorecard = { ...signal.discoveryScorecard, score: 95 };
  const refreshed = revalidateCandidate(signal, { ...signal });
  assert.equal(refreshed.authorizedDecisionScore, authorizedScore);
  assert.equal(refreshed.masterFinalScore, authorizedScore);
  assert.equal(refreshed.scoreVersion, version);
  assert.ok(refreshed.currentAnalyticalScore >= authorizedScore);
  assert.equal(refreshed.stockDecisionScore, refreshed.currentAnalyticalScore);
  assert.equal(refreshed.centralReviewStatus, "NONE");
});
