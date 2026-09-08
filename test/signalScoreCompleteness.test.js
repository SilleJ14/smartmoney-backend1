import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeSignalScoreCollection,
  normalizeSignalScoreCompleteness,
} from "../scoring/signalScoreCompleteness.js";

test("explicit disabled score flags survive conflicting nested availability", () => {
  const stock = normalizeSignalScoreCompleteness({ symbol: "AAPL", stockDecisionScore: 85,
    stockDecisionScoreAvailable: false, stockDecisionEvidence: { coreEvidencePass: true } });
  const crypto = normalizeSignalScoreCompleteness({ symbol: "BTC/USD", cryptoDecisionScore: 85,
    cryptoDecisionScoreAvailable: false, cryptoEntryScore: 80, cryptoEntryScoreAvailable: false,
    centralAutonomousDecisionCore: { cryptoDecisionEvidence: { coreEvidencePass: true,
      componentsByName: { execution: { available: true, value: 80 } } } } });
  assert.equal(stock.stockDecisionScore, null);
  assert.equal(stock.stockDecisionScoreAvailable, false);
  assert.equal(crypto.cryptoDecisionScore, null);
  assert.equal(crypto.cryptoEntryScore, null);
});

test("complete stock D/E/F/MD evidence is published with measured zero preserved", () => {
  const normalized = normalizeSignalScoreCompleteness({
    symbol: "AAPL",
    assetClass: "stock",
    discoveryScore: 72,
    discoveryScorecard: {
      score: 72,
      coverage: 0.85,
      canonicalExtensionEvidencePass: true,
    },
    entryQualityScore: 80,
    entryQualityScorecard: { score: 80, coverage: 0.9, approved: true },
    masterFinalScore: 84,
    stockDecisionScore: 81,
    stockDecisionEvidence: { coreEvidencePass: true },
    continuationScorecard: {
      score: 0,
      sessionEvidenceVerified: true,
      observedSessions: 1,
    },
  });

  assert.equal(normalized.discoveryScoreAvailable, true);
  assert.equal(normalized.entryQualityScoreAvailable, true);
  assert.equal(normalized.stockDecisionScoreAvailable, true);
  assert.equal(normalized.stockDecisionScore, 84);
  assert.equal(normalized.multiDayScoreAvailable, true);
  assert.equal(normalized.multiDayScore, 0);
  assert.deepEqual(normalized.missingEvidenceReasons, ['POSITION_SIZING_PENDING']);
});

test("incomplete stock evidence never promotes a generic or provisional score to canonical F", () => {
  const normalized = normalizeSignalScoreCompleteness({
    symbol: "WATCH",
    assetClass: "stock",
    score: 99,
    discoveryScore: 70,
    discoveryScorecard: {
      score: 70,
      coverage: 0.8,
      canonicalExtensionEvidencePass: false,
      missingComponents: ["dailyExtensionHistory"],
    },
    entryQualityScore: 76,
    entryQualityScorecard: { score: 76, coverage: 0.6 },
    stockDecisionScore: 88,
    stockDecisionScoreAvailable: true,
    stockDecisionEvidence: {
      coreEvidencePass: false,
      missingCriticalEvidence: ["entryEvidence"],
    },
    continuationScorecard: { score: 50, sessionEvidenceVerified: false },
  });

  assert.equal(normalized.discoveryScore, null);
  assert.equal(normalized.entryQualityScore, null);
  assert.equal(normalized.stockDecisionScore, null);
  assert.equal(normalized.stockDecisionScoreAvailable, false);
  assert.equal(normalized.provisionalStockDecisionScore, 88);
  assert.equal(normalized.provisionalStockDecisionScoreAvailable, true);
  assert.equal(normalized.multiDayScore, null);
  assert.equal(normalized.multiDayScoreAvailable, false);
  assert.ok(normalized.missingEvidenceReasons.includes("dailyExtensionHistory"));
  assert.ok(normalized.missingEvidenceReasons.includes("entryEvidence"));
  assert.ok(normalized.missingEvidenceReasons.includes("CANONICAL_STOCK_FINAL_DECISION_UNAVAILABLE"));
  assert.ok(normalized.missingEvidenceReasons.includes("STOCK_MULTI_DAY_EVIDENCE_UNAVAILABLE"));
});

test("complete crypto D/E/F/MD evidence retains legitimate zero-valued measurements", () => {
  const normalized = normalizeSignalScoreCompleteness({
    symbol: "BTC/USD",
    assetClass: "crypto",
    cryptoDiscoveryScore: 0,
    cryptoDiscoveryScorecard: { score: 0, coverage: 0.65 },
    cryptoEntryScore: 0,
    cryptoEntryScorecard: { score: 0, available: true },
    cryptoDecisionScore: 65,
    centralAutonomousDecisionCore: {
      cryptoDecisionEvidence: {
        coreEvidencePass: true,
        componentsByName: { execution: { available: true, value: 0 } },
      },
    },
    continuationScorecard: { score: 0, available: true, observedSessions: 2 },
  });

  assert.equal(normalized.cryptoDiscoveryScoreAvailable, true);
  assert.equal(normalized.cryptoDiscoveryScore, 0);
  assert.equal(normalized.cryptoEntryScoreAvailable, true);
  assert.equal(normalized.cryptoEntryScore, 0);
  assert.equal(normalized.cryptoDecisionScoreAvailable, true);
  assert.equal(normalized.cryptoDecisionScore, 65);
  assert.equal(normalized.multiDayScoreAvailable, true);
  assert.equal(normalized.multiDayScore, 0);
  assert.deepEqual(normalized.missingEvidenceReasons, ['POSITION_SIZING_PENDING']);
});

test("incomplete crypto evidence exposes exact reasons and keeps provisional F non-canonical", () => {
  const normalized = normalizeSignalScoreCompleteness({
    symbol: "ETH/USD",
    assetClass: "crypto",
    score: 97,
    cryptoDiscoveryScore: 71,
    cryptoDiscoveryScorecard: { score: 71, coverage: 0.7 },
    cryptoEntryScore: 83,
    cryptoEntryScoreAvailable: true,
    cryptoDecisionScore: 88,
    cryptoDecisionScoreAvailable: true,
    provisionalCryptoDecisionScore: 62,
    centralAutonomousDecisionCore: {
      cryptoDecisionEvidence: {
        coreEvidencePass: false,
        missingCriticalEvidence: ["liveSpread"],
        componentsByName: { execution: { available: false, value: 83 } },
      },
    },
    continuationScorecard: { score: 50, available: false, observedSessions: 1 },
  });

  assert.equal(normalized.cryptoEntryScore, null);
  assert.equal(normalized.cryptoEntryScoreAvailable, false);
  assert.equal(normalized.cryptoDecisionScore, null);
  assert.equal(normalized.cryptoDecisionScoreAvailable, false);
  assert.equal(normalized.provisionalCryptoDecisionScore, 62);
  assert.equal(normalized.provisionalCryptoDecisionScoreAvailable, true);
  assert.equal(normalized.multiDayScore, null);
  assert.equal(normalized.multiDayScoreAvailable, false);
  assert.ok(normalized.missingEvidenceReasons.includes("liveSpread"));
  assert.ok(normalized.missingEvidenceReasons.includes("CRYPTO_ENTRY_SCORE_UNAVAILABLE"));
  assert.ok(normalized.missingEvidenceReasons.includes("CANONICAL_CRYPTO_FINAL_DECISION_UNAVAILABLE"));
  assert.ok(normalized.missingEvidenceReasons.includes("CRYPTO_MULTI_DAY_EVIDENCE_UNAVAILABLE"));
  assert.equal(normalized.score, 97);
});

test("score collection normalization drops empty candidates without changing order", () => {
  const normalized = normalizeSignalScoreCollection([
    { symbol: "AAPL", stockDecisionScore: 80 },
    null,
    { symbol: "BTC/USD", cryptoDecisionScore: 70 },
  ]);

  assert.deepEqual(normalized.map((signal) => signal.symbol), ["AAPL", "BTC/USD"]);
  assert.equal(normalized[0].stockDecisionScoreAvailable, false);
  assert.equal(normalized[1].cryptoDecisionScoreAvailable, false);
});
