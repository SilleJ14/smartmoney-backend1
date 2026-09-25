import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { STOCK_EXECUTION_THRESHOLDS, analyticalStockPass } from "../scoring/stockQualificationPolicy.js";
import { buildCandidateFunnel, requireCanonicalOrder, stockLongOrderAllowed } from "../scoring/candidateFunnel.js";
import { buildStockDecisionScore, calculateEntryQualityScore, evaluateStockTradeCandidate } from "../scoring/decisionScores.js";
import { evaluateCryptoTradeCandidate } from "../scoring/componentScore.js";
import { classifyStockExecution } from "../scoring/executionPolicy.js";
import { providerFailureDoesNotScore, symbolEvidenceFromHealth } from "../market-data/providerHealth.js";
import {
  finalScoreBucket,
  measurePricePath,
  updateStockScoreOutcomes,
} from "../scoring/stockScoreOutcomeTracker.js";
import { evaluateCanonicalStockAutoBuyEligibility } from "../strategies/autoBuyStrategies.js";

const server = fs.readFileSync(new URL("../server.js", import.meta.url), "utf8");
const phone = fs.readFileSync(new URL("../../app/(tabs)/index.tsx", import.meta.url), "utf8");
const autoBuy = fs.readFileSync(new URL("../strategies/autoBuyStrategies.js", import.meta.url), "utf8");
const scanner = fs.readFileSync(new URL("../strategies/stockMarketStrategy.js", import.meta.url), "utf8");

function orderRecord(symbol, decision) {
  return {
    symbol,
    time: "2026-09-25T15:00:00.000Z",
    D: 80,
    E: 80,
    F: decision.finalScore ?? decision.score ?? null,
    stage: decision.blocker,
    status: decision.allowed ? "BUYABLE" : "REJECTED",
    exactBlocker: decision.blocker,
  };
}

test("full pipeline acceptance from market data to Buyable or a recorded blocker", () => {
  assert.equal(STOCK_EXECUTION_THRESHOLDS.finalScore, 70);

  const paths = ["scanner", "continuation", "starter", "manual", "auto-trade", "crypto-rotation", "execution"];
  for (const path of paths) {
    const blocked = requireCanonicalOrder(path, {
      entryApproved: true,
      finalScore: 74,
      authorized: false,
      C: "PASS",
      X: "PASS",
      R: "PASS",
      S: 25,
    });
    const record = orderRecord("PATH", blocked);
    assert.equal(blocked.allowed, false);
    assert.equal(record.exactBlocker, "authorization");
    assert.equal(record.status, "REJECTED");
  }
  const buyable = requireCanonicalOrder("auto-trade", {
    entryApproved: true,
    finalScore: 74,
    authorized: true,
    C: "PASS",
    X: "PASS",
    R: "PASS",
    S: 25,
  });
  assert.equal(buyable.allowed, true);
  assert.equal(buyable.requiredFinalScore, 70);
  assert.equal(requireCanonicalOrder("scanner", {
    entryApproved: true,
    finalScore: 69,
    authorized: true,
    C: "PASS",
    X: "PASS",
    R: "PASS",
    S: 25,
  }).blocker, "final");
  const cryptoBlocked = requireCanonicalOrder("crypto-rotation", {
    asset: "crypto",
    shadow: null,
    authorized: true,
    S: 25,
  });
  assert.equal(cryptoBlocked.allowed, false);
  assert.equal(cryptoBlocked.inheritsLegacyThreshold, false);

  assert.match(scanner, /evaluateStockTradeCandidate/);
  assert.match(autoBuy, /evaluateStockTradeCandidate/);
  assert.match(autoBuy, /liveCryptoPermission/);
  assert.match(server, /requireCanonicalOrder\("starter"/);
  assert.match(server, /requireCanonicalOrder\("manual"/);
  assert.match(server, /requireCanonicalOrder\("execution"/);
  assert.match(server, /requireCanonicalOrder\("crypto-order"/);
  assert.match(server, /evaluateCryptoTradeCandidate/);
  assert.doesNotMatch(server, /minimumScore: 85/);
  assert.doesNotMatch(autoBuy, /minimumScore: 85/);
  assert.doesNotMatch(phone, /cryptoDecisionScore >= 65/);
  assert.doesNotMatch(phone, /STOCK_QUALIFIED_SCORE = 72/);
  assert.equal(analyticalStockPass({ finalScore: 74, entryApproved: true, entryCoverage: 0.8 }), true);
  assert.equal(analyticalStockPass({ finalScore: 69, entryApproved: true, entryCoverage: 0.8 }), false);

  const priced = {
    price: 11,
    bid: 10.99,
    ask: 11.01,
    technicalBarsFound: 40,
    technicals: {
      ema9: 10.8,
      ema20: 10.4,
      macd: 0.2,
      macdSignal: 0.1,
      rsi: 58,
    },
    confirmations: { aboveVwap: true, closeNearHighPercent: 80, fakeBreakout: false, newsRiskAvailable: true },
    discoveryScorecard: { score: 80, buyScore: 80, coverage: 1, canonicalExtensionEvidencePass: true },
    contextScore: 70,
    riskPortfolioScore: 70,
    fundamentalDataValid: true,
    fundamentalBlendScore: 70,
  };
  const entry = calculateEntryQualityScore(priced);
  const first = buildStockDecisionScore({ ...priced, entryQualityScorecard: entry });
  const second = buildStockDecisionScore({ ...priced, entryQualityScorecard: entry });
  assert.equal(first.score, second.score);
  assert.notEqual(first.score, 0);
  const missingFundamentals = buildStockDecisionScore({
    ...priced,
    fundamentalDataValid: false,
    fundamentalBlendScore: undefined,
    entryQualityScorecard: entry,
  });
  const fundamentals = missingFundamentals.components.find((component) => component.name === "fundamentals");
  assert.equal(fundamentals.available, false);
  assert.equal(fundamentals.value, null);
  const stale = buildStockDecisionScore({
    ...priced,
    liveQuoteUpdatedAt: "2026-09-25T12:00:00.000Z",
    entryQualityScorecard: entry,
  });
  assert.equal(stale.score, first.score);

  const stages = [
    [{ basicFilterPassed: false }, "BASIC_FILTER"],
    [{ basicFilterPassed: true, discoveryScore: null }, "DISCOVERY_COMPLETE"],
    [{ basicFilterPassed: true, discoveryScore: 40, technicalEvidenceReady: true }, "D_THRESHOLD"],
    [{ basicFilterPassed: true, discoveryScore: 80, technicalEvidenceReady: false }, "TECHNICAL_EVIDENCE"],
    [{ basicFilterPassed: true, discoveryScore: 80, technicalEvidenceReady: true, entryQualityScore: 80, entryApproved: false, currentAnalyticalScore: 80 }, "ENTRY_THRESHOLD"],
    [{ basicFilterPassed: true, discoveryScore: 80, technicalEvidenceReady: true, entryApproved: true, entryQualityScore: 80, currentAnalyticalScore: 69 }, "F_THRESHOLD"],
  ];
  for (const [patch, stage] of stages) {
    const row = buildCandidateFunnel({ symbol: "ZZ", price: 10, ...patch }, { now: "2026-09-25T15:00:00.000Z" });
    assert.equal(row.stage, stage);
    assert.equal(row.status, "REJECTED");
    assert.equal(row.exactBlocker, stage);
    assert.equal(row.symbol, "ZZ");
    assert.ok(row.time);
  }
  for (const [decision, blocker] of [
    [stockLongOrderAllowed({ entryApproved: true, finalScore: 74, authorized: false, C: "PASS", X: "PASS", R: "PASS", S: 10 }), "authorization"],
    [stockLongOrderAllowed({ entryApproved: true, finalScore: 74, authorized: true, C: "WAIT", X: "PASS", R: "PASS", S: 10 }), "C"],
    [stockLongOrderAllowed({ entryApproved: true, finalScore: 74, authorized: true, C: "PASS", X: "WAIT", R: "PASS", S: 10 }), "X"],
    [stockLongOrderAllowed({ entryApproved: true, finalScore: 74, authorized: true, C: "PASS", X: "PASS", R: "REJECT", S: 10 }), "R"],
    [stockLongOrderAllowed({ entryApproved: true, finalScore: 74, authorized: true, C: "PASS", X: "PASS", R: "PASS", S: 0 }), "S"],
  ]) {
    const record = orderRecord("ZZ", { ...decision, finalScore: 74 });
    assert.equal(record.exactBlocker, blocker);
    assert.equal(record.F, 74);
    assert.equal(record.status, "REJECTED");
  }

  assert.equal(symbolEvidenceFromHealth({ providerHealthy: false }).state, "DATA_UNAVAILABLE");
  assert.equal(symbolEvidenceFromHealth({ providerHealthy: false }).score, null);
  assert.equal(providerFailureDoesNotScore().final, null);
  assert.equal(providerFailureDoesNotScore().deteriorated, false);
  assert.equal(classifyStockExecution({ quoteAgeMs: 14000, spreadAgeMs: 1000, spreadPercent: 0.2 }).reason, "QUOTE_STALE");
  assert.equal(classifyStockExecution({ quoteAgeMs: 1000, spreadAgeMs: 1000, spreadPercent: 1.4 }).reason, "SPREAD_TOO_WIDE");
  assert.equal(classifyStockExecution({ quoteAgeMs: 1000, spreadAgeMs: 1000, spreadPercent: 0.2, bookAvailable: false }).reason, "BOOK_UNAVAILABLE");
  assert.equal(classifyStockExecution({ quoteAgeMs: 1000, spreadAgeMs: 1000, spreadPercent: 0.2 }).changesFinalScore, false);
  const cryptoMissing = evaluateCryptoTradeCandidate({
    symbol: "BTC/USD",
    cryptoDiscoveryScorecard: {
      score: 90,
      coverage: 1,
      calculatedAt: "2026-09-25T15:00:00.000Z",
      extension: { alreadyExtended: false },
    },
  }, { now: Date.parse("2026-09-25T15:00:00.000Z"), requireCentralDecision: false, requireFreshDecision: false, requireExplicitApproval: false });
  assert.equal(cryptoMissing.approved, false);
  assert.notEqual(cryptoMissing.score, 0);

  const start = Date.parse("2026-09-25T15:00:00.000Z");
  const prints = [
    { at: start, price: 100 },
    { at: start + 60 * 1000, price: 95 },
    { at: start + 5 * 60 * 1000, price: 110 },
    { at: start + 15 * 60 * 1000, price: 103 },
  ];
  const measured = measurePricePath(100, prints, { spreadPercent: 0.2 });
  assert.equal(measured.maximumFavorableExcursion, 10);
  assert.equal(measured.maximumAdverseExcursion, -5);
  assert.equal(measured.hitPlus3, true);
  assert.equal(measured.hitPlus5, true);
  assert.equal(measured.hitPlus10, true);
  assert.equal(measured.hitMinus2, true);
  assert.equal(measured.hitMinus5, true);
  assert.equal(measured.timeToPeakMs, 5 * 60 * 1000);
  assert.equal(measured.netResultPercent, 2.8);
  assert.equal(measurePricePath(100, []).maximumFavorableExcursion, null);

  const buckets = [52, 57, 62, 67, 72, 77, 82, 86];
  const observedAt = Date.parse("2026-09-25T15:00:00.000Z");
  const universe = buckets.map((score, index) => ({
    symbol: `B${score}`,
    currentAnalyticalScore: score,
    price: 100,
    buyable: score >= 70,
    buyBlockReason: score >= 70 ? null : "F_THRESHOLD",
    pricePath: prints,
    measuredSpreadPercent: 0.2,
  }));
  const started = Date.now();
  const tracked = updateStockScoreOutcomes({}, universe, { now: observedAt, maxObservations: 500 });
  const elapsedMs = Date.now() - started;
  assert.equal(tracked.observationCount, buckets.length);
  assert.ok(elapsedMs < 5000);
  for (const score of buckets) {
    const row = tracked.observations.find((observation) => observation.finalScore === score);
    assert.equal(row.scoreBand, finalScoreBucket(score));
    assert.equal(row.rejected, score < 70);
    assert.equal(row.maximumFavorableExcursion, 10);
    assert.equal(row.retunesThreshold, false);
  }
  const wider = Array.from({ length: 40 }, (_, index) => ({
    symbol: `U${index}`,
    currentAnalyticalScore: 60 + (index % 30),
    price: 10 + index,
    buyable: false,
    buyBlockReason: "BASIC_FILTER",
  }));
  const loaded = updateStockScoreOutcomes({}, wider, { now: observedAt });
  assert.equal(loaded.observationCount, 40);

  const fresh = new Date().toISOString();
  const open = evaluateCanonicalStockAutoBuyEligibility({
    currentAnalyticalScore: 74,
    stockDecisionScore: 74,
    stockDecisionScoreAvailable: true,
    entryQualityScore: 80,
    entryQualityScorecard: { approved: true, coverage: 0.8, score: 80 },
    discoveryScorecard: { coverage: 1 },
    decisionScoreCoverage: 1,
    centralAutonomousAction: "ALLOW",
    riskScore: 80,
    spreadPercent: 0.2,
    liveQuoteUpdatedAt: fresh,
    spreadUpdatedAt: fresh,
    liveQuoteSource: "alpaca_latest_stock_quote",
    spreadSource: "alpaca_latest_stock_quote",
    priceIsLive: true,
    decisionUpdatedAt: fresh,
    qualifiedToBuy: true,
    autoTradeApproved: true,
    approved: true,
    backendApproved: true,
  }, 70);
  assert.equal(open.approved, true, JSON.stringify(open.evidence?.reasons || open.reasons));
  assert.equal(open.minimumScore, 70);
  assert.match(server, /Duplicate buy blocked/);
  assert.match(server, /Canonical pipeline blocked/);
});
