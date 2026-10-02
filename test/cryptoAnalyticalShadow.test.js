import test from "node:test";
import assert from "node:assert/strict";
import { buildCryptoDecisionScore, CRYPTO_DECISION_WEIGHTS, evaluateCryptoTradeCandidate } from "../scoring/componentScore.js";
import { CRYPTO_ANALYTICAL_THRESHOLD, CRYPTO_ANALYTICAL_SCORE, liveCryptoPermission } from "../scoring/cryptoAnalyticalShadow.js";
import { revalidateCandidate } from "../scoring/revalidateCandidate.js";
import { getCanonicalFinalScore } from "../scoring/canonicalSignalRank.js";
import { normalizeSignalScoreCompleteness } from "../scoring/signalScoreCompleteness.js";
import { CRYPTO_SETUP_TYPES } from "../scoring/cryptoSetupModels.js";

const now = Date.parse("2026-09-25T14:00:00.000Z");

function ladderBook() {
  return {
    source: "alpaca_crypto_orderbook",
    location: "us",
    symbol: "BTC/USD",
    updatedAt: new Date(now).toISOString(),
    asks: [{ p: 100.2, s: 250 / 100.2 }, { p: 100.5, s: 2500 / 100.5 }],
    bids: [{ p: 99.8, s: 250 / 99.8 }, { p: 99.5, s: 2500 / 99.5 }],
  };
}

function deepBook(bid, ask) {
  return {
    source: "alpaca_crypto_orderbook",
    location: "us",
    symbol: "BTC/USD",
    updatedAt: new Date(now).toISOString(),
    asks: [{ p: ask, s: 100 }],
    bids: [{ p: bid, s: 100 }],
  };
}

function signal(overrides = {}) {
  return {
    symbol: "BTC/USD",
    assetClass: "crypto",
    cryptoDiscoveryScorecard: {
      score: 88,
      coverage: 1,
      calculatedAt: new Date(now).toISOString(),
      extension: { alreadyExtended: false },
    },
    cryptoContextScorecard: { score: 80, independent: true, source: "independent_crypto_context" },
    newsCatalyst: { dataAvailable: true, riskDetected: false },
    barsFound: 30,
    current: 100,
    price: 100,
    dollarVolume24h: 5_000_000_000,
    intendedNotional: 25,
    priceIsLive: true,
    liveQuoteSource: "alpaca_crypto_latest",
    spreadSource: "alpaca_crypto_latest",
    bid: 99.85,
    ask: 100.15,
    cryptoOrderbook: deepBook(99.85, 100.15),
    ...overrides,
  };
}

function fresh(overrides = {}) {
  return signal({
    liveQuoteUpdatedAt: new Date(now).toISOString(),
    spreadUpdatedAt: new Date(now).toISOString(),
    ...overrides,
  });
}

function stale(overrides = {}) {
  return signal({
    liveQuoteUpdatedAt: new Date(now - 30_000).toISOString(),
    spreadUpdatedAt: new Date(now - 30_000).toISOString(),
    ...overrides,
  });
}

function breakoutBars() {
  return Array.from({ length: 30 }, (_, index) => {
    const last = index === 29;
    return {
      t: now - (31 - index) * 60_000,
      o: last ? 100.2 : 100,
      h: last ? 102.2 : 100.3,
      l: last ? 100.1 : 99.8,
      c: last ? 102 : 100,
      v: last ? 300 : 100,
      intervalMs: 60_000,
    };
  });
}

test("a stale quote keeps analytical F visible and waits on execution", () => {
  const evidence = buildCryptoDecisionScore(stale(), { now });
  const shadow = evidence.cryptoAnalyticalShadow;
  assert.equal(shadow.cryptoAnalyticalF, 88);
  assert.equal(shadow.analyticalCoverage, 1);
  assert.equal(shadow.X.state, "WAIT");
  assert.ok(shadow.X.reasons.includes("QUOTE_STALE"));
  assert.equal(shadow.buyable, false);
  assert.equal(evidence.coreEvidencePass, false);
  assert.equal(evidence.scoreStatus, "PROVISIONAL_INCOMPLETE_EVIDENCE");
  const gate = evaluateCryptoTradeCandidate(stale(), { now, requireCentralDecision: false, requireExplicitApproval: false, requireFreshDecision: false });
  assert.equal(gate.score, 88);
  assert.equal(gate.scoreAvailable, true);
  assert.equal(gate.approved, false);
  assert.ok(gate.reasons.includes("QUOTE_STALE"));
});

test("a fresh book leaves analytical F unchanged and execution can pass", () => {
  const staleShadow = buildCryptoDecisionScore(stale(), { now }).cryptoAnalyticalShadow;
  const freshEvidence = buildCryptoDecisionScore(fresh(), { now });
  const shadow = freshEvidence.cryptoAnalyticalShadow;
  assert.equal(shadow.cryptoAnalyticalF, 88);
  assert.equal(shadow.cryptoAnalyticalF, staleShadow.cryptoAnalyticalF);
  assert.equal(shadow.X.state, "PASS");
  assert.notEqual(freshEvidence.score, shadow.cryptoAnalyticalF);
  assert.equal(shadow.legacyCryptoF, freshEvidence.score);
});

test("a wider quoted spread rejects execution without moving F", () => {
  const tight = buildCryptoDecisionScore(fresh(), { now }).cryptoAnalyticalShadow;
  const wide = buildCryptoDecisionScore(fresh({
    bid: 99.55,
    ask: 100.45,
    cryptoOrderbook: deepBook(99.55, 100.45),
  }), { now }).cryptoAnalyticalShadow;
  assert.equal(tight.cryptoAnalyticalF, wide.cryptoAnalyticalF);
  assert.equal(tight.X.state, "PASS");
  assert.equal(wide.X.spreadState.state, "REJECT");
  assert.equal(wide.X.state, "REJECT");
});

test("a missing book leaves F unchanged and marks execution unavailable", () => {
  const withBook = buildCryptoDecisionScore(fresh(), { now }).cryptoAnalyticalShadow;
  const withoutBook = buildCryptoDecisionScore(fresh({ cryptoOrderbook: null }), { now }).cryptoAnalyticalShadow;
  assert.equal(withoutBook.cryptoAnalyticalF, withBook.cryptoAnalyticalF);
  assert.equal(withoutBook.X.bookState.state, "DATA_UNAVAILABLE");
  assert.equal(withoutBook.X.state, "DATA_UNAVAILABLE");
  assert.equal(withoutBook.buyable, false);
});

test("required crypto news distinguishes unavailable evidence from measured negative news", () => {
  const unavailable = buildCryptoDecisionScore(fresh({
    newsCatalystRequired: true,
    newsCatalyst: { dataAvailable: false },
  }), { now }).cryptoAnalyticalShadow;
  assert.equal(unavailable.C.state, "DATA_UNAVAILABLE");
  assert.equal(unavailable.C.reason, "NEWS_PROVIDER_UNAVAILABLE");
  assert.ok(liveCryptoPermission(unavailable).reasons.includes("NEWS_PROVIDER_UNAVAILABLE"));

  const negative = buildCryptoDecisionScore(fresh({
    newsCatalystRequired: true,
    newsCatalyst: { dataAvailable: true, riskDetected: true,
      newsEvidence: { providerState: "AVAILABLE", coverageState: "COVERED", adverseState: "NEGATIVE" } },
  }), { now }).cryptoAnalyticalShadow;
  assert.equal(negative.C.state, "REJECT");
  assert.equal(negative.C.reason, "NEGATIVE_CATALYST");
  assert.equal(negative.buyable, false);
  assert.ok(liveCryptoPermission(negative).reasons.includes("NEGATIVE_CATALYST"));
});

test("a reported spread without measured bid and ask is analytical-only", () => {
  const shadow = buildCryptoDecisionScore(fresh({
    bid: null,
    ask: null,
    spreadAvailable: true,
    spreadPercent: 0.3,
  }), { now }).cryptoAnalyticalShadow;
  assert.equal(shadow.cryptoAnalyticalF, 88);
  assert.equal(shadow.X.spreadState.state, "DATA_UNAVAILABLE");
  assert.equal(shadow.X.spreadState.reason, "QUOTED_SPREAD_UNAVAILABLE");
  assert.equal(shadow.buyable, false);
});

test("a larger order can fail the book walk without changing F", () => {
  const small = buildCryptoDecisionScore(fresh({
    bid: 99.8,
    ask: 100.2,
    intendedNotional: 15,
    cryptoOrderbook: ladderBook(),
  }), { now }).cryptoAnalyticalShadow;
  const large = buildCryptoDecisionScore(fresh({
    bid: 99.8,
    ask: 100.2,
    intendedNotional: 400,
    cryptoOrderbook: ladderBook(),
  }), { now }).cryptoAnalyticalShadow;
  assert.equal(small.cryptoAnalyticalF, large.cryptoAnalyticalF);
  assert.equal(small.X.sizeEconomicsState.state, "PASS");
  assert.equal(large.X.sizeEconomicsState.state, "REJECT");
  assert.equal(large.X.sizeEconomicsState.reason, "SIZE_EXCEEDS_USABLE_DEPTH");
  assert.notEqual(small.X.state, large.X.state);
});

test("missing context keeps the measured discovery score and waits on context", () => {
  const evidence = buildCryptoDecisionScore(fresh({
    cryptoDiscoveryScorecard: {
      score: 82,
      coverage: 1,
      calculatedAt: new Date(now).toISOString(),
      extension: { alreadyExtended: false },
    },
    cryptoContextScorecard: undefined,
  }), { now });
  const shadow = evidence.cryptoAnalyticalShadow;
  assert.equal(shadow.cryptoAnalyticalF, 82);
  assert.equal(shadow.analyticalCoverage, 1);
  assert.equal(shadow.cryptoMarketContext.state, "DATA_UNAVAILABLE");
  assert.equal(shadow.cryptoMarketContext.score, null);
  assert.equal(shadow.R.state, "WAIT");
  assert.equal(shadow.buyable, false);
});

test("execution evidence cannot change analytical coverage", () => {
  const missingExecution = buildCryptoDecisionScore(stale(), { now }).cryptoAnalyticalShadow;
  const presentExecution = buildCryptoDecisionScore(fresh(), { now }).cryptoAnalyticalShadow;
  assert.equal(missingExecution.analyticalCoverage, presentExecution.analyticalCoverage);
  assert.equal(CRYPTO_ANALYTICAL_SCORE.includesExecution, false);
  assert.equal(CRYPTO_ANALYTICAL_SCORE.includesMarketBreadth, false);
});

test("the legacy formula and the analytical score are stored together", () => {
  const evidence = buildCryptoDecisionScore(fresh(), { now });
  const shadow = evidence.cryptoAnalyticalShadow;
  assert.equal(shadow.legacyCryptoF, evidence.score);
  assert.equal(shadow.cryptoAnalyticalF, 88);
  assert.equal(shadow.replacesCanonicalF, true);
  assert.equal(shadow.productionEffect, true);
  assert.equal(CRYPTO_DECISION_WEIGHTS.runner, 0);
  assert.equal(shadow.runnerWeight, 0);
});

test("the production decision path evaluates all five independent setup families", () => {
  const evidence = buildCryptoDecisionScore(fresh({
    price: 102,
    current: 102,
    chartBars: breakoutBars(),
  }), { now });
  assert.deepEqual(
    Object.keys(evidence.setup.cryptoSetupAssessment.candidates),
    [...CRYPTO_SETUP_TYPES]
  );
  assert.equal(evidence.entry.setupType, "BREAKOUT");
  assert.equal(evidence.entry.approved, true);
  assert.equal(evidence.cryptoAnalyticalShadow.E.state, "PASS");
});

test("the new analytical score does not inherit the legacy 65 gate", () => {
  assert.equal(CRYPTO_ANALYTICAL_THRESHOLD.status, "NOT_CALIBRATED");
  assert.equal(CRYPTO_ANALYTICAL_THRESHOLD.analyticalMinimum, null);
  assert.equal(CRYPTO_ANALYTICAL_THRESHOLD.legacyFormulaFinalScore, 65);
  const low = buildCryptoDecisionScore(fresh({
    cryptoDiscoveryScorecard: {
      score: 40,
      coverage: 1,
      calculatedAt: new Date(now).toISOString(),
      extension: { alreadyExtended: false },
    },
    cryptoContextScorecard: { score: 40, independent: true, source: "independent_crypto_context" },
  }), { now }).cryptoAnalyticalShadow;
  assert.equal(low.cryptoAnalyticalF, 40);
  assert.equal(low.threshold.analyticalMinimum, null);
  assert.equal(low.X.state, "PASS");
});

test("quote refresh publishes discovery F and keeps the legacy composite diagnostic-only", () => {
  const original = fresh();
  const evidence = buildCryptoDecisionScore(original, { now });
  const previous = {
    ...original,
    approved: true,
    backendApproved: true,
    autoTradeApproved: true,
    qualifiedToBuy: true,
    cryptoDecisionScore: 41,
    cryptoDecisionScoreAvailable: true,
    currentAnalyticalScore: 88,
    authorizedDecisionScore: 88,
    decisionUpdatedAt: new Date(now).toISOString(),
    centralAutonomousDecisionCore: {
      action: "ALLOW",
      cryptoDecisionScore: 88,
      cryptoDecisionEvidence: evidence,
    },
  };
  const refreshed = revalidateCandidate(previous, fresh(), { now });
  assert.equal(refreshed.cryptoDecisionScore, 88);
  assert.equal(refreshed.currentAnalyticalScore, 88);
  assert.equal(getCanonicalFinalScore(refreshed), 88);
  assert.equal(refreshed.legacyCryptoCompositeScore, evidence.score);
  assert.notEqual(refreshed.legacyCryptoCompositeScore, refreshed.cryptoDecisionScore);
  assert.equal(refreshed.currentAnalyticalSnapshot.F, 88);
});

test("recovered crypto evidence drops stale unavailable reasons", () => {
  const evidence = buildCryptoDecisionScore(fresh(), { now });
  const normalized = normalizeSignalScoreCompleteness({
    ...fresh(),
    cryptoDecisionScore: 88,
    cryptoDecisionScoreAvailable: true,
    cryptoAnalyticalShadow: evidence.cryptoAnalyticalShadow,
    cryptoScoreTelemetry: { decision: evidence },
    missingEvidenceReasons: [
      "MISSING_BASE",
      "CRYPTO_DISCOVERY_SCORE_UNAVAILABLE",
      "ORDER_BOOK_UNAVAILABLE",
    ],
  });
  assert.equal(normalized.cryptoDecisionScore, 88);
  assert.equal(normalized.missingEvidenceReasons.includes("MISSING_BASE"), false);
  assert.equal(normalized.missingEvidenceReasons.includes("CRYPTO_DISCOVERY_SCORE_UNAVAILABLE"), false);
  assert.equal(normalized.missingEvidenceReasons.includes("ORDER_BOOK_UNAVAILABLE"), false);
});
