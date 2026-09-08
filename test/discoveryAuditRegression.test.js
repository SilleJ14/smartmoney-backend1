import test from "node:test";
import assert from "node:assert/strict";
import { compareCanonicalSignals, dedupeSignalsByCanonicalAuthority, getCanonicalFinalScore } from "../scoring/canonicalSignalRank.js";
import { evaluateStockTradeCandidate } from "../scoring/decisionScores.js";
import { evaluateCryptoTradeCandidate } from "../scoring/componentScore.js";
import { mergeLiveQuoteEvidence } from "../live/liveQuoteCache.js";
import { calculateQuietPreMoveFeatures, compactGroupedRows } from "../discovery/quietDiscoveryPipeline.js";
import { calculateCryptoEarlyDiscoveryScore } from "../scoring/earlyDiscovery.js";
import { hydrateCryptoContinuationMemoryFromDailyBars } from "../scoring/cryptoScoring.js";
import { updateQuietCandidateOutcomes, getQuietFollowupSymbols } from "../scoring/quietCandidateOutcomeTracker.js";

const now = Date.now();
const iso = (t = now) => new Date(t).toISOString();
const permission = { approved: true, backendApproved: true, autoTradeApproved: true, qualifiedToBuy: true };
const base = { symbol: "AAPL", ...permission, masterFinalScore: 90, stockDecisionScoreAvailable: true,
  entryQualityScore: 90, entryQualityScorecard: { approved: true, coverage: 1 }, discoveryScorecard: { coverage: 1 },
  decisionScoreCoverage: 1, centralAutonomousAction: "ALLOW", riskScore: 70, bid: 100, ask: 100.01,
  spreadAvailable: true, spreadUpdatedAt: iso(), quoteFetchedAt: iso(), decisionUpdatedAt: iso(),
  liveQuoteSource: "alpaca_latest_stock_quote", spreadSource: "alpaca_latest_stock_quote", priceIsLive: true };

test("explicit stock F invalidation defeats numeric aliases at execution", () => {
  assert.equal(evaluateStockTradeCandidate(base, { now }).approved, true);
  const invalid = { ...base, stockDecisionScoreAvailable: false };
  assert.equal(getCanonicalFinalScore(invalid), null);
  assert.equal(evaluateStockTradeCandidate(invalid, { now }).approved, false);
});
test("explicit spread invalidation defeats a leftover positive pair", () => {
  const invalid = { ...base, spreadAvailable: false };
  assert.equal(evaluateStockTradeCandidate(invalid, { now }).approved, false);
  const quote = mergeLiveQuoteEvidence(base, invalid, { price: 100, quoteUpdatedAt: iso() });
  assert.equal(quote.spreadAvailable, false);
});
test("crypto invalid F remains unavailable in the execution evaluator", () => {
  const result = evaluateCryptoTradeCandidate({ symbol: "BTC/USD", ...permission, cryptoDecisionScore: 90,
    cryptoDecisionScoreAvailable: false, bid: 100, ask: 100.01, spreadAvailable: false });
  assert.equal(result.scoreAvailable, false);
  assert.equal(result.approved, false);
});
test("equal timestamp rejection wins in either duplicate order", () => {
  const rejection = { ...base, approved: false };
  for (const input of [[base, rejection], [rejection, base]]) {
    assert.equal(dedupeSignalsByCanonicalAuthority(input)[0].approved, false);
  }
});
test("same-time evidence invalidation wins even if obsolete approval flags remain", () => {
  const invalid = { ...base, stockDecisionScoreAvailable: false };
  for (const rows of [[base, invalid], [invalid, base]]) assert.equal(getCanonicalFinalScore(dedupeSignalsByCanonicalAuthority(rows)[0]), null);
});
test("future decisions and refreshed live-score time cannot outrank a rejection", () => {
  const rejection = { ...base, decisionUpdatedAt: iso(now - 1000), approved: false };
  const old = { ...base, decisionUpdatedAt: iso(now - 10000), liveScoreUpdatedAt: iso() };
  assert.equal(dedupeSignalsByCanonicalAuthority([rejection, old])[0].approved, false);
  assert.equal(dedupeSignalsByCanonicalAuthority([rejection, { ...base, decisionUpdatedAt: "2099-01-01" }])[0].approved, false);
});
test("currently executable candidate sorts before stale retained approval", () => {
  const stale = { ...base, symbol: "STALE", executionEligibility: { approved: false }, buyableNow: false };
  const fresh = { ...base, symbol: "FRESH", masterFinalScore: 80, executionEligibility: { approved: true }, buyableNow: true };
  assert.equal([stale, fresh].sort(compareCanonicalSignals)[0].symbol, "FRESH");
});
const bars = Array.from({ length: 25 }, (_, i) => ({ s: "QUIET", d: new Date(now - (25 - i) * 86400000).toISOString().slice(0, 10),
  o: 100, h: 101, l: 99, c: 100, v: 100000 }));
test("undated and future quiet bars never establish completed extension evidence", () => {
  assert.equal(calculateQuietPreMoveFeatures(bars.map(({ d, ...row }) => row)), null);
  assert.equal(calculateQuietPreMoveFeatures(bars.map((row, i) => ({ ...row, d: `2099-01-${String(i + 1).padStart(2, "0")}` }))), null);
});
test("old crypto history cannot become a current discovery or continuation", () => {
  const old = bars.map((row, i) => ({ ...row, t: `2020-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`, d: undefined }));
  const discovery = calculateCryptoEarlyDiscoveryScore({ dailyBars: old, currentPrice: 100, now });
  assert.ok(discovery.coverage < 0.5);
  assert.equal(hydrateCryptoContinuationMemoryFromDailyBars({}, old, { now: new Date(now) }).available, false);
});
test("invalid grouped rows do not consume the valid-universe allowance", () => {
  assert.equal(compactGroupedRows([{ T: "BAD" }, { T: "GOOD", d: '2026-09-01', o: 10, h: 11, l: 9, c: 10, v: 100 }], "2026-09-01", 1)[0].s, "GOOD");
});
test("stale learning quotes do not record a profit, and missing candidates get followups", () => {
  const start = Date.parse("2026-09-01T12:00:00Z");
  const selected = [{ symbol: "BTC/USD", price: 100, liveQuoteUpdatedAt: iso(start) }];
  const first = updateQuietCandidateOutcomes({}, selected, selected, { assetClass: "crypto", dayKey: "2026-09-01", now: start });
  assert.equal(first.observationCount, 1);
  const stale = updateQuietCandidateOutcomes(first, [], [{ symbol: "BTC/USD", price: 120, liveQuoteUpdatedAt: "2020-01-01" }],
    { assetClass: "crypto", dayKey: "2026-09-02", now: start + 86400000 });
  assert.equal(stale.observations[0].measurements[1], undefined);
  assert.deepEqual(getQuietFollowupSymbols(stale, { now: start + 86400000 }), ["BTC/USD"]);
  const fresh = updateQuietCandidateOutcomes(stale, [], [{ symbol: "BTC/USD", price: 110, liveQuoteUpdatedAt: iso(start + 86400000) }],
    { assetClass: "crypto", dayKey: "2026-09-02", now: start + 86400000 });
  assert.equal(fresh.observations[0].measurements[1].closeReturnPercent, 10);
});
test("retention exclusions are disclosed rather than claimed as full coverage", () => {
  const rows = Array.from({ length: 350 }, (_, i) => ({ symbol: `C${i}/USD`, price: 100, liveQuoteUpdatedAt: iso() }));
  const result = updateQuietCandidateOutcomes({}, rows, rows, { assetClass: "crypto", now });
  assert.equal(result.discoveryPopulationThisUpdate, 350);
  assert.equal(result.observationCount, 40);
  assert.equal(result.untrackedDiscoveriesThisUpdate, 310);
  assert.equal(result.trackingPolicy, "BOUNDED_DISCOVERY_SAMPLE_NOT_FULL_POPULATION");
});
