import test from "node:test";
import assert from "node:assert/strict";
import {
  compareCanonicalSignals,
  dedupeSignalsByCanonicalAuthority,
  getCanonicalFinalScore,
  hasExplicitTradeApproval,
  isCryptoSignal,
} from "../scoring/canonicalSignalRank.js";

test("explicit unavailable F wins over stale nested positive evidence", () => {
  assert.equal(getCanonicalFinalScore({ symbol: "AAPL", stockDecisionScore: 85,
    stockDecisionScoreAvailable: false, stockDecisionEvidence: { coreEvidencePass: true } }), null);
  assert.equal(getCanonicalFinalScore({ symbol: "BTC/USD", cryptoDecisionScore: 85,
    cryptoDecisionScoreAvailable: false, cryptoScoreTelemetry: { decision: { coreEvidencePass: true } } }), null);
});

test("failed current evidence cannot be overridden by stale available flags when ranking", () => {
  const unavailable = [
    { symbol: "AAPL", stockDecisionScore: 95, stockDecisionScoreAvailable: true,
      stockDecisionEvidence: { coreEvidencePass: false },
      centralAutonomousDecisionCore: { stockDecisionEvidence: { coreEvidencePass: true } } },
    { symbol: "BTC/USD", cryptoDecisionScore: 95, cryptoDecisionScoreAvailable: true,
      cryptoScoreTelemetry: { decision: { coreEvidencePass: false } },
      centralAutonomousDecisionCore: { cryptoDecisionEvidence: { coreEvidencePass: true } } },
  ];
  const complete = { symbol: "MSFT", stockDecisionScore: 78,
    stockDecisionScoreAvailable: true, stockDecisionEvidence: { coreEvidencePass: true } };
  for (const candidate of unavailable) {
    assert.equal(getCanonicalFinalScore(candidate), null, candidate.symbol);
    assert.deepEqual([candidate, complete].sort(compareCanonicalSignals).map(row => row.symbol),
      [complete.symbol, candidate.symbol]);
  }
});

test("current validated evidence has the same precedence as score publication", () => {
  assert.equal(getCanonicalFinalScore({ symbol: "AAPL", stockDecisionScore: 78,
    stockDecisionEvidence: { coreEvidencePass: true },
    centralAutonomousDecisionCore: { stockDecisionEvidence: { coreEvidencePass: false } } }), 78);
  assert.equal(getCanonicalFinalScore({ symbol: "BTC/USD", cryptoDecisionScore: 65,
    cryptoScoreTelemetry: { decision: { coreEvidencePass: true } },
    centralAutonomousDecisionCore: { cryptoDecisionEvidence: { coreEvidencePass: false } } }), 65);
});

test("newer decision rejection replaces older approval in either input order", () => {
  const old = { symbol: "AAPL", stockDecisionScore: 90, stockDecisionScoreAvailable: true,
    approved: true, backendApproved: true, autoTradeApproved: true, qualifiedToBuy: true,
    recommendedTradeAmount: 100, decisionUpdatedAt: "2026-09-01T14:00:00Z" };
  const rejected = { symbol: "AAPL", stockDecisionScore: null, stockDecisionScoreAvailable: false,
    approved: false, decisionUpdatedAt: "2026-09-01T14:01:00Z" };
  for (const input of [[old, rejected], [rejected, old]]) {
    const [result] = dedupeSignalsByCanonicalAuthority(input);
    assert.equal(result.approved, false);
    assert.equal(result.stockDecisionScore, null);
    assert.equal(result.recommendedTradeAmount, undefined);
    assert.equal(getCanonicalFinalScore(result), null);
  }
});

test("candidate ranking uses canonical F and explicit approval, never legacy score", () => {
  const approvedLowerF = {
    symbol: "AAA",
    score: 10,
    stockDecisionScore: 78,
    stockDecisionScoreAvailable: true,
    qualifiedToBuy: true,
    autoTradeApproved: true,
    approved: true,
    backendApproved: true,
  };
  const unapprovedHighLegacy = {
    symbol: "BBB",
    score: 99,
    stockDecisionScore: 91,
    stockDecisionScoreAvailable: true,
    qualifiedToBuy: false,
    autoTradeApproved: false,
  };
  const unavailable = {
    symbol: "CCC",
    score: 100,
    stockDecisionScore: 100,
    stockDecisionScoreAvailable: false,
  };
  const ranked = [unavailable, unapprovedHighLegacy, approvedLowerF].sort(compareCanonicalSignals);
  assert.deepEqual(ranked.map((item) => item.symbol), ["AAA", "BBB", "CCC"]);
  assert.equal(getCanonicalFinalScore(unavailable), null);
});

test("mixed provider crypto symbols dedupe into one canonical scored record", () => {
  const deduped = dedupeSignalsByCanonicalAuthority([
    {
      symbol: "X:BTCUSD",
      assetClass: "crypto",
      price: 61_250,
      bid: 61_249,
      ask: 61_251,
      spreadAvailable: true,
      spreadUpdatedAt: "2026-09-01T14:30:05.000Z",
      liveQuoteUpdatedAt: "2026-09-01T14:30:05.000Z",
    },
    {
      symbol: "BTC/USD",
      assetClass: "crypto",
      cryptoDecisionScore: 84,
      cryptoDecisionScoreAvailable: true,
      centralAutonomousDecisionCore: {
        cryptoDecisionEvidence: { coreEvidencePass: true },
      },
    },
    { symbol: "BTC-USD", assetClass: "crypto", percentChange: 5 },
    { symbol: "BTCUSD", assetClass: "crypto", volume: 1000 },
  ], { normalizeSymbol: (value) => String(value || "").toUpperCase() });

  assert.equal(deduped.length, 1);
  assert.equal(deduped[0].symbol, "BTC/USD");
  assert.equal(deduped[0].cryptoDecisionScore, 84);
  assert.equal(deduped[0].price, 61_250);
  assert.equal(deduped[0].bid, 61_249);
});

test("three-letter USD equity symbol remains a stock", () => {
  assert.equal(isCryptoSignal({ symbol: "USD", assetClass: "stock" }), false);
  assert.equal(isCryptoSignal({ symbol: "BTCUSD" }), true);
  assert.equal(isCryptoSignal({ symbol: "X:ETHUSD" }), true);
});

test("raw early mover cannot shadow a later canonical scored candidate", () => {
  const deduped = dedupeSignalsByCanonicalAuthority([
    {
      symbol: "AAPL",
      rawEarlyMover: true,
      discoveryOnly: true,
      stockDecisionScore: null,
      stockDecisionScoreAvailable: false,
      price: 101,
      liveQuoteUpdatedAt: "2026-09-01T14:00:05.000Z",
      candidateSource: "RAW_EARLY_MOVER",
    },
    {
      symbol: "aapl",
      assetClass: "stock",
      stockDecisionScore: 82,
      stockDecisionScoreAvailable: true,
      discoveryScore: 75,
      discoveryScoreAvailable: true,
      entryQualityScore: 79,
      entryQualityScoreAvailable: true,
      multiDayScore: 66,
      multiDayScoreAvailable: true,
      decisionUpdatedAt: "2026-09-01T14:00:00.000Z",
    },
  ], { normalizeSymbol: (value) => String(value || "").toUpperCase() });

  assert.equal(deduped.length, 1);
  assert.equal(deduped[0].symbol, "AAPL");
  assert.equal(deduped[0].stockDecisionScore, 82);
  assert.equal(deduped[0].stockDecisionScoreAvailable, true);
  assert.equal(deduped[0].price, 101);
  assert.equal(deduped[0].rawEarlyMover, false);
  assert.equal(deduped[0].discoveryOnly, undefined);
  assert.equal(deduped[0].earlyMover, true);
  assert.equal(deduped[0].earlyMoverEvidence.source, "RAW_EARLY_MOVER");
});

test("candidate approval requires every explicit backend approval field", () => {
  const complete = {
    qualifiedToBuy: true,
    autoTradeApproved: true,
    approved: true,
    backendApproved: true,
  };
  assert.equal(hasExplicitTradeApproval(complete), true);
  for (const field of Object.keys(complete)) {
    const missing = { ...complete };
    delete missing[field];
    assert.equal(hasExplicitTradeApproval(missing), false, `${field} is required`);
  }
});

test("canonical F uses one stable score priority for stocks and crypto", () => {
  assert.equal(getCanonicalFinalScore({
    symbol: "AAPL",
    masterFinalScore: 84,
    finalAutonomousDecisionScore: 82,
    stockDecisionScore: 70,
    stockDecisionScoreAvailable: true,
  }), 84);
  assert.equal(getCanonicalFinalScore({
    symbol: "BTC/USD",
    assetClass: "crypto",
    cryptoDecisionScore: 65,
    masterFinalScore: 90,
    cryptoDecisionScoreAvailable: true,
  }), 65);
});
