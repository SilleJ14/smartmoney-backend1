import test from "node:test";
import { cryptoSetupEvidence } from './fixtures/cryptoSetupFixture.js';
import assert from "node:assert/strict";
import fs from "node:fs";
import { installCentralDecision } from "../scoring/installCentralDecision.js";
import { buildCryptoDecisionScore, evaluateCryptoTradeCandidate } from "../scoring/componentScore.js";
import { calculateEntryQualityScore, evaluateStockTradeCandidate } from "../scoring/decisionScores.js";
import { getCanonicalFinalScore } from "../scoring/canonicalSignalRank.js";
import { normalizeSignalScoreCollection } from "../scoring/signalScoreCompleteness.js";
import { createCryptoExecutionQuoteRefresher } from "../market-data/cryptoExecutionQuoteRefresh.js";
import { createStockExecutionQuoteRefresher } from "../market-data/stockExecutionQuoteRefresh.js";
import { calculateCryptoLiquidityFromBars } from "../scoring/cryptoScoring.js";
import { createFairReviewQueue, takeExplorationWindow } from "../discovery/fairExploration.js";
import { updateQuietCandidateOutcomes, getQuietFollowupSymbols } from "../scoring/quietCandidateOutcomeTracker.js";
import { createStockQuoteBatch } from "../market-data/stockQuoteBatch.js";
import { getStockExecutionEvidenceFreshness } from "../market-data/stockQuoteEvidence.js";
import { createAlpacaClient } from "../execution/alpacaClient.js";
import { fetchAlpacaGroupedDaily } from "../discovery/alpacaDailyBars.js";

const now = Date.now();
const iso = (t = now) => new Date(t).toISOString();
const approvals = { approved: true, backendApproved: true, autoTradeApproved: true, qualifiedToBuy: true };
const crypto = () => ({ symbol: "BTC/USD", price: 100, current: 100, ...cryptoSetupEvidence(100, now),
  cryptoDiscoveryScorecard: { score: 90, coverage: 1, calculatedAt: iso(), extension: { alreadyExtended: false } },
  newsCatalyst: { dataAvailable: true, riskDetected: false }, barsFound: 30, windowDollarVolume: 1000000,
  bid: 99.95, ask: 100.05, spreadAvailable: true, priceIsLive: true,
  liveQuoteUpdatedAt: iso(), spreadUpdatedAt: iso(), liveQuoteSource: "alpaca_crypto_latest", spreadSource: "alpaca_crypto_latest",
  multiDayContinuationScore: 75, multiDayAccumulation: { seenDays: [2, 1].map((d) => iso(now - d * 86400000).slice(0, 10)) },
  cryptoDecisionScore: null, cryptoDecisionScoreAvailable: false,
  recommendedTradeAmount: 100, ...approvals });
const decisionFor = (signal) => {
  const evidence = buildCryptoDecisionScore(signal, { now });
  return { action: "ALLOW", updatedAt: iso(), cryptoDecisionScore: evidence.score,
    finalDecisionScore: evidence.score, cryptoDecisionEvidence: evidence };
};
const cryptoRefresh = createCryptoExecutionQuoteRefresher({ normalizeSymbol: String,
  getLatestQuotes: async () => [crypto()], updateQuoteCache: (_, q) => q });

test("pending crypto -> central ALLOW -> provider refresh -> final qualification preserves current sizing", async () => {
  const signal = crypto();
  installCentralDecision(signal, decisionFor(signal), { crypto: true, now });
  let [row] = await cryptoRefresh([signal]);
  assert.equal(row.cryptoDecisionScoreAvailable, true);
  assert.ok(row.cryptoDecisionScore >= 65);
  assert.equal(evaluateCryptoTradeCandidate(row, { now }).approved, true);
  assert.equal(row.recommendedTradeAmount, 100);
  installCentralDecision(row, decisionFor(row), { crypto: true, now });
  [row] = await cryptoRefresh([row]);
  assert.equal(evaluateCryptoTradeCandidate(row, { now }).approved, true);
  assert.equal(getCanonicalFinalScore(normalizeSignalScoreCollection([row])[0]), row.cryptoDecisionScore);
});

test("installing a new score never restores a risk revocation or zero sizing", async () => {
  const signal = { ...crypto(), approved: false, backendApproved: false, recommendedTradeAmount: 0 };
  installCentralDecision(signal, decisionFor(signal), { crypto: true, now });
  const [row] = await cryptoRefresh([signal]);
  assert.equal(evaluateCryptoTradeCandidate(row, { now }).approved, false);
  assert.equal(row.backendApproved, false);
  assert.equal(row.recommendedTradeAmount, 0);
});

test("immediate-entry crypto without MD survives central installation and quote refresh with sizing", async () => {
  const signal = { ...crypto(), multiDayContinuationScore: null,
    multiDayAccumulation: { seenDays: [] }, multiDayScoreAvailable: false,
    continuationScorecard: { score: 50, available: false } };
  installCentralDecision(signal, decisionFor(signal), { crypto: true, now });
  const [row] = await cryptoRefresh([signal]);
  assert.equal(row.cryptoDecisionScoreAvailable, true);
  assert.equal(evaluateCryptoTradeCandidate(row, { now }).approved, true);
  assert.equal(row.recommendedTradeAmount, 100);
  assert.equal(row.multiDayScoreAvailable, false);
});

test("new stock central evidence replaces pending availability and old failed evidence", () => {
  const signal = { symbol: "AAPL", stockDecisionScoreAvailable: false, stockDecisionEvidence: { coreEvidencePass: false }, masterFinalScore: 12 };
  installCentralDecision(signal, { action: "ALLOW", finalDecisionScore: 90, stockDecisionEvidence: { coreEvidencePass: true } }, { now });
  assert.equal(getCanonicalFinalScore(signal), 90);
  assert.equal(getCanonicalFinalScore(normalizeSignalScoreCollection([signal])[0]), 90);
  installCentralDecision(signal, { action: "WATCH", finalDecisionScore: 90, stockDecisionEvidence: { coreEvidencePass: false } }, { now });
  assert.equal(getCanonicalFinalScore(signal), null);
  assert.equal(signal.stockDecisionScore, null);
});

test("both production central passes install score availability with the new decision", () => {
  const source = fs.readFileSync(new URL("../engine/createEngineCycle.js", import.meta.url), "utf8");
  assert.equal((source.match(/installCentralDecision\(matchingSignal, decision/g) || []).length, 2);
});

const stock = () => {
  const signal = { symbol: "AAPL", price: 100, current: 100, bid: 99.995, ask: 100.005,
    priceIsLive: true, spreadAvailable: true, liveQuoteUpdatedAt: iso(), spreadUpdatedAt: iso(),
    liveQuoteSource: "alpaca_latest_stock_quote", spreadSource: "alpaca_latest_stock_quote",
    technicalBarsFound: 30, technicals: { ema9: 101, ema20: 99, macd: 2, macdSignal: 1, rsi: 60 },
    confirmations: { closeNearHighPercent: 82, aboveVwap: true, fakeBreakout: false },
    phase5SignalQuality: { liquidityStabilityScore: 80, antiChaseRisk: 10, exhaustionRisk: 10, spreadWideningRisk: 10, breakoutRetestConfirmation: true },
    discoveryScorecard: { score: 90, coverage: 1, canonicalExtensionEvidencePass: true },
    riskScore: 90, riskPortfolioScore: 90, contextScore: 90, decisionScoreCoverage: 1,
    ...approvals, recommendedTradeAmount: 100 };
  signal.entryQualityScorecard = calculateEntryQualityScore(signal);
  signal.entryQualityScore = signal.entryQualityScorecard.score;
  installCentralDecision(signal, { action: "ALLOW", finalDecisionScore: 85, stockDecisionEvidence: { coreEvidencePass: true } }, { now });
  return signal;
};

test("fresh 0.9% spread cannot reuse E90 approval when current E falls below 75", async () => {
  const signal = stock();
  assert.equal(evaluateStockTradeCandidate(signal, { requireCentralDecision: true, requireFreshDecision: true, requireExplicitApproval: true, now }).approved, true);
  const refresh = createStockExecutionQuoteRefresher({ normalizeSymbol: String,
    getLatestQuotes: async () => [{ ...signal, bid: 99.55, ask: 100.45, spreadPercent: 0.9 }],
    updateQuoteCache: (_, q) => q });
  const [row] = await refresh([signal]);
  assert.ok(signal.entryQualityScore > 90);
  assert.ok(row.entryQualityScore < 75);
  assert.equal(row.executionEligibility.approved, false);
  assert.equal(row.finalApprovedTradeAmount, 0);
  assert.equal(evaluateStockTradeCandidate(row, { now }).approved, false);
  assert.equal(row.decisionUpdatedAt, signal.decisionUpdatedAt);
});

test("valid refreshed stock remains eligible but refresh cannot promote its central F", async () => {
  const signal = stock();
  installCentralDecision(signal, { action: "ALLOW", finalDecisionScore: 99, stockDecisionEvidence: { coreEvidencePass: true } }, { now });
  const refresh = createStockExecutionQuoteRefresher({ normalizeSymbol: String,
    getLatestQuotes: async () => [signal], updateQuoteCache: (_, q) => q });
  const [row] = await refresh([signal]);
  assert.equal(row.executionEligibility.approved, true);
  assert.equal(row.stockDecisionScore, 99);
  assert.equal(row.recommendedTradeAmount, 100);
});

test("quote deterioration can cross the F threshold even when current E still passes", async () => {
  const signal = stock();
  installCentralDecision(signal, { action: "ALLOW", finalDecisionScore: 78, stockDecisionEvidence: { coreEvidencePass: true } }, { now });
  const refresh = createStockExecutionQuoteRefresher({ normalizeSymbol: String,
    getLatestQuotes: async () => [{ ...signal, bid: 99.8, ask: 100.2, spreadPercent: 0.4 }], updateQuoteCache: (_, q) => q });
  const [row] = await refresh([signal]);
  assert.ok(row.entryQualityScore >= 75);
  assert.ok(row.stockDecisionScore < 78);
  assert.equal(row.executionEligibility.approved, false);
  assert.equal(row.finalApprovedTradeAmount, 0);
});

test("cached discovery calls admit every rotating window before consuming reviews", async () => {
  const source = fs.readFileSync(new URL("../server.js", import.meta.url), "utf8");
  const body = source.match(/async function discoverPreMovers\([^]*?\n}\r?\n/)[0];
  const reviewed = new Set();
  let cached = false;
  const dependencies = {
    takePreMoverReview: createFairReviewQueue(5000), normalizeSymbol: String, isValidStockSymbol: () => true,
    getPreMoverCache: () => ({ fresh: cached, symbols: [] }), engineState: {},
    processBatches: (items, _, fn) => Promise.all(items.map(fn)), getRecentBars: async () => [],
    calculateCanonicalPreMoverScore: ({ symbol }) => { reviewed.add(symbol); return { symbol, preMoveScore: 80 }; },
    prunePreMoverMemory: (memory) => ({ memory }), saveEngineState() {},
  };
  const discover = new Function(...Object.keys(dependencies), `${body}; return discoverPreMovers;`)(...Object.values(dependencies));
  const pool = Array.from({ length: 600 }, (_, i) => `S${i}`);
  let cursor = 0;
  for (let i = 0; i < 30; i++) {
    const window = takeExplorationWindow(pool, [], { cursor, limit: 300 });
    cursor = window.cursor;
    cached = i % 2 === 1;
    await discover(window.symbols);
  }
  assert.equal(reviewed.size, 600);
});

test("crypto 1m/5m/15m liquidity is identical for ISO, epoch seconds and milliseconds", () => {
  for (const minutes of [1, 5, 15]) {
    const bars = Array.from({ length: 30 }, (_, i) => ({ t: now - (30 - i) * minutes * 60000, c: 100, v: 100 }));
    const expected = calculateCryptoLiquidityFromBars(bars, 100);
    for (const convert of [(t) => iso(t), (t) => t / 1000]) {
      const actual = calculateCryptoLiquidityFromBars(bars.map((b) => ({ ...b, t: convert(b.t) })), 100);
      assert.equal(actual.medianBarMinutes, minutes);
      assert.equal(actual.normalizedWindowDollarVolume, expected.normalizedWindowDollarVolume);
    }
  }
  const unknown = calculateCryptoLiquidityFromBars(Array.from({ length: 30 }, () => ({ c: 100, v: 100 })), 100);
  assert.equal(unknown.liquidityPass, false);
  assert.equal(unknown.medianBarMinutes, null);
});

test("missing benchmark can complete without another candidate quote, within its window", () => {
  const row = (symbol, price, time) => ({ symbol, price, changePercent: 1, liveQuoteUpdatedAt: iso(time) });
  const eth = row("ETH/USD", 100, now), btc = row("BTC/USD", 100, now);
  const baseline = updateQuietCandidateOutcomes({}, [eth], [eth, btc], { assetClass: "crypto", now });
  const target = now + 86400000;
  const measured = updateQuietCandidateOutcomes(baseline, [], [row("ETH/USD", 110, target)], { assetClass: "crypto", now: target });
  assert.equal(measured.observations[0].benchmarkMeasurements[1].Bitcoin, null);
  assert.ok(getQuietFollowupSymbols(measured, { now: target + 1000 }).includes("BTC/USD"));
  const completed = updateQuietCandidateOutcomes(measured, [], [row("BTC/USD", 105, target + 2000)], { assetClass: "crypto", now: target + 2000 });
  assert.equal(completed.observations[0].benchmarkMeasurements[1].Bitcoin, 5);
  assert.deepEqual(completed.observations[0].measurements[1], measured.observations[0].measurements[1]);
  assert.equal(measured.observations[0].benchmarkMeasurements[1].Bitcoin, null, "previous state is immutable");
  const expired = updateQuietCandidateOutcomes(measured, [], [row("BTC/USD", 200, target + 7 * 3600000)], { assetClass: "crypto", now: target + 7 * 3600000 });
  assert.equal(expired.observations[0].benchmarkMeasurements[1].Bitcoin, null);
});

test("slow missing-symbol fallback cannot block a fresh Tradier quote until stale", async () => {
  const q = { ...stock(), liveQuoteSource: "tradier_stock_quote", spreadSource: "tradier_stock_quote", liveQuoteUpdatedAt: new Date().toISOString(), spreadUpdatedAt: new Date().toISOString() };
  let aborted = false;
  const batch = createStockQuoteBatch({ primary: async () => [q], normalizeSymbol: String, maxFallbackMs: 20,
    fallback: async (symbols, { signal }) => {
      assert.deepEqual(symbols, ["MISSING"]);
      return new Promise((resolve) => signal.addEventListener("abort", () => { aborted = true; resolve([]); }, { once: true }));
    } });
  const [row] = await batch(["AAPL", "MISSING"]);
  assert.equal(aborted, true);
  assert.equal(getStockExecutionEvidenceFreshness(row).quoteFresh, true);
  assert.equal(row.liveQuoteUpdatedAt, q.liveQuoteUpdatedAt);
});

test("return-time checks do not label an expired provider quote live", async () => {
  let clock = now;
  const batch = createStockQuoteBatch({ primary: async () => [stock()], normalizeSymbol: String, now: () => clock,
    fallback: async () => { clock += 6000; return []; } });
  const [row] = await batch(["AAPL", "MISSING"]);
  assert.equal(row.priceIsLive, false);
  assert.equal(row.spreadAvailable, false);
});

test("real Alpaca client charges padded body bytes across pages", async () => {
  let page = 0;
  const client = createAlpacaClient({ getKeys: () => ({ key: "mock", secret: "mock" }), dataBaseUrl: "https://mock.invalid",
    fetchWithTimeout: async () => {
      page++;
      return new Response(" ".repeat(1200) + JSON.stringify({ bars: { AAPL: [{ t: "2026-09-04T04:00:00Z", o: 10, h: 11, l: 9, c: 10, v: 100 }] }, next_page_token: page < 3 ? `p${page}` : null }));
    } });
  await assert.rejects(fetchAlpacaGroupedDaily({ symbols: ["AAPL"], dateKey: "2026-09-04", dataRequest: client.dataRequest, maxDownloadBytes: 2000 }), /byte budget/);
  assert.equal(page, 2, "third page must not be downloaded");
});

test("provider fallback retains previous download consumption", () => {
  const source = fs.readFileSync(new URL("../server.js", import.meta.url), "utf8");
  assert.match(source, /maxDownloadBytes: DISCOVERY_MAX_DOWNLOAD_BYTES - downloadedBytes/);
  assert.match(source, /downloadedBytes \+= alpaca.downloadedBytes/);
});
