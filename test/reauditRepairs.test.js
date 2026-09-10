import test from "node:test";
import { cryptoSetupEvidence } from './fixtures/cryptoSetupFixture.js';
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildCryptoDecisionScore, evaluateCryptoTradeCandidate } from "../scoring/componentScore.js";
import { buildStockDecisionScore, calculateMultiDayContinuationScore } from "../scoring/decisionScores.js";
import { getApprovedTradeAmount } from "../scoring/approvedSizing.js";
import { selectStockExecutionQuote } from "../market-data/stockQuoteSelection.js";
import { providerDailyBar } from "../discovery/providerDailyBar.js";
import { createDiscoveryFeatureStore } from "../discovery/featureStore.js";
import { fetchAlpacaGroupedDaily } from "../discovery/alpacaDailyBars.js";
import { takeExplorationWindow, createFairReviewQueue } from "../discovery/fairExploration.js";
import { dedupeSignalsByCanonicalAuthority } from "../scoring/canonicalSignalRank.js";
import { mergeLiveQuoteEvidence, cleanupLiveQuoteCache } from "../live/liveQuoteCache.js";
import { updateQuietCandidateOutcomes, getQuietFollowupSymbols, summarizeQuietCandidateOutcomes } from "../scoring/quietCandidateOutcomeTracker.js";
import { readBoundedResponseText } from "../utils/boundedResponse.js";
import { runBoundedQuietDiscovery } from "../discovery/quietDiscoveryPipeline.js";
import { buildLiveMovers } from "../market-data/liveMovers.js";
import { createCryptoExecutionQuoteRefresher } from "../market-data/cryptoExecutionQuoteRefresh.js";
import { createAutoBuyStrategies } from "../strategies/autoBuyStrategies.js";

const now = Date.now();
const iso = (time = now) => new Date(time).toISOString();
const crypto = (overrides = {}) => ({ symbol: "BTC/USD", price: 100, current: 100, ...cryptoSetupEvidence(100, now),
  cryptoDiscoveryScorecard: { score: 90, coverage: 1, calculatedAt: iso(), extension: { alreadyExtended: false } },
  newsCatalyst: { dataAvailable: true, riskDetected: false }, barsFound: 30, windowDollarVolume: 1_000_000,
  bid: 99.95, ask: 100.05, spreadAvailable: true, priceIsLive: true,
  liveQuoteUpdatedAt: iso(), spreadUpdatedAt: iso(), liveQuoteSource: "alpaca_crypto_latest", spreadSource: "alpaca_crypto_latest",
  multiDayContinuationScore: 75, multiDayAccumulation: { seenDays: [1, 2].map((d) => iso(now - d * 86400000).slice(0, 10)) },
  cryptoDecisionScore: 85, cryptoDecisionScoreAvailable: true, recommendedTradeAmount: 100,
  approved: true, backendApproved: true, qualifiedToBuy: true, autoTradeApproved: true, decisionUpdatedAt: iso(),
  centralAutonomousDecisionCore: { updatedAt: iso(), action: "ALLOW", cryptoDecisionEvidence: { coreEvidencePass: true } },
  ...overrides });

test("current crypto evidence, not cached F85, decides eligibility", () => {
  assert.equal(evaluateCryptoTradeCandidate(crypto(), { now }).approved, true);
  const weaker = crypto({ bid: 99.6, ask: 100.4, multiDayContinuationScore: 60,
    cryptoDiscoveryScorecard: { score: 60, coverage: 1, calculatedAt: iso(), extension: { alreadyExtended: false } } });
  const result = evaluateCryptoTradeCandidate(weaker, { now });
  assert.equal(result.evidence.coreEvidencePass, true);
  assert.ok(result.score < 65);
  assert.equal(result.score, buildCryptoDecisionScore(weaker, { now }).score);
  assert.equal(result.approved, false);
});

test("expired central decisions and WATCH actions cannot authorize crypto buys", () => {
  for (const changes of [{ decisionUpdatedAt: "2025-01-01" },
    { centralAutonomousAction: "WATCH" }, { decisionUpdatedAt: iso(now + 60000) }]) {
    assert.equal(evaluateCryptoTradeCandidate(crypto(changes), { now }).approved, false);
  }
});

test("stock-only sources cannot qualify crypto", () => {
  for (const changes of [{ liveQuoteSource: "tradier_stock_quote" }, { spreadSource: "polygon_rest_quote" }]) {
    assert.equal(buildCryptoDecisionScore(crypto(changes), { now }).coreEvidencePass, false);
  }
});

test("old/count-only continuation remains unavailable without invalidating immediate-entry evidence", () => {
  for (const multiDayAccumulation of [{ seenDays: ["2025-01-01", "2025-01-02"] }, { seenDaysCount: 99 }]) {
    const result = buildCryptoDecisionScore(crypto({ multiDayAccumulation }), { now });
    assert.equal(result.componentsByName.runner.available, false);
    assert.equal(result.coreEvidencePass, true);
    assert.equal(result.score, buildCryptoDecisionScore(crypto(), { now }).score);
  }
});

test("explicit zero cannot resurrect sizing from raw or previous starter amounts", () => {
  const item = crypto({ recommendedTradeAmount: 0, rawRecommendedTradeAmount: 125 });
  assert.equal(getApprovedTradeAmount(item), 0);
  assert.equal(getApprovedTradeAmount({ rawRecommendedTradeAmount: 125 }), 0);
  const [row] = buildLiveMovers({ state: { topCryptoSignals: [item], aiEntryScores: { "BTC/USD": { starterAmount: 200 } } },
    normalizeSymbol: (s) => s.toUpperCase(), isCrypto: () => true, mergeLiveQuote: (s) => s, now: () => new Date(now) });
  assert.equal(row.recommendedTradeAmount, 0);
  assert.equal(row.buyableNow, false);
});

test("fresh Alpaca pair wins over fresh Tradier trade with stale spread", () => {
  const tradier = { ...crypto(), symbol: "AAPL", liveQuoteSource: "tradier_stock_quote", spreadSource: "tradier_stock_quote",
    spreadUpdatedAt: iso(now - 60000) };
  const alpaca = { ...tradier, liveQuoteUpdatedAt: iso(now - 500), spreadUpdatedAt: iso(now - 500),
    liveQuoteSource: "alpaca_latest_stock_quote", spreadSource: "alpaca_latest_stock_quote" };
  assert.equal(selectStockExecutionQuote(tradier, alpaca, { now }), alpaca);
});

test("ISO and numeric daily bars seed the actual feature store identically", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "smartmoney-reaudit-"));
  try {
    const store = createDiscoveryFeatureStore({ directory });
    const bar = { o: 100, h: 101, l: 99, c: 100, v: 10000, t: "2026-09-04T04:00:00Z" };
    const numeric = providerDailyBar("AAPL", { ...bar, t: Date.parse(bar.t) });
    assert.deepEqual(numeric, providerDailyBar("AAPL", bar));
    store.seedHistories([[numeric]], "2026-09-07");
    const read = await store.readRecentHistories();
    assert.equal(read.histories.get("AAPL")[0].d, "2026-09-04");
    assert.equal(providerDailyBar("AAPL", { ...bar, t: undefined }), null);
    assert.equal(providerDailyBar("AAPL", { ...bar, t: "2099-01-01" }), null);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("grouped fallback rejects undated bars and repeated pagination tokens", async () => {
  const row = { o: 100, h: 101, l: 99, c: 100, v: 100 };
  await assert.rejects(fetchAlpacaGroupedDaily({ symbols: ["AAPL"], dateKey: "2026-09-04",
    dataRequest: async () => ({ bars: { AAPL: [row] } }) }), /no daily bars/);
  let calls = 0;
  await assert.rejects(fetchAlpacaGroupedDaily({ symbols: ["AAPL"], dateKey: "2026-09-04",
    dataRequest: async () => { calls++; return { bars: { AAPL: [{ ...row, t: "2026-09-04T04:00:00Z" }] }, next_page_token: "repeat" }; } }), /pagination/);
  assert.equal(calls, 2);
});

test("exploration plus bounded review eventually visits all 600 symbols", () => {
  const pool = Array.from({ length: 600 }, (_, i) => `S${i}`);
  const priority = Array.from({ length: 100 }, (_, i) => `P${i}`);
  const seen = new Set();
  const review = createFairReviewQueue();
  let cursor = 0;
  for (let i = 0; i < 40; i++) {
    const window = takeExplorationWindow(pool, priority, { cursor, limit: 300 });
    cursor = window.cursor;
    for (const symbol of review(window.symbols, 80)) seen.add(symbol);
  }
  assert.equal(pool.filter((symbol) => seen.has(symbol)).length, 600);
});

test("duplicate candidates cannot assemble a bid/ask pair from different records", () => {
  const [row] = dedupeSignalsByCanonicalAuthority([
    { symbol: "AAPL", bid: 100, ask: 201, spreadPercent: 0.1, spreadAvailable: true, spreadUpdatedAt: iso(now - 1000),
      price: 150, liveQuoteUpdatedAt: iso(now - 1000), approved: true, decisionUpdatedAt: iso(now - 1000) },
    { symbol: "AAPL", bid: 200, approved: false, decisionUpdatedAt: iso() },
  ]);
  assert.notEqual(row.bid, 200);
  assert.ok(row.spreadPercent > 60);
});

test("undated incoming bid/ask cannot borrow a fresh trade timestamp", () => {
  const pair = mergeLiveQuoteEvidence({}, { bid: 99, ask: 101 }, { price: 100, quoteUpdatedAt: iso() });
  assert.equal(pair.spreadAvailable, false);
  assert.equal(pair.spreadUpdatedAt, null);
});

test("malformed scorecards and last-year continuation cannot establish current evidence", () => {
  const result = buildStockDecisionScore({ discoveryScorecard: { score: 90 }, entryQualityScorecard: { score: 90, approved: true }, riskPortfolioScore: 90 });
  assert.equal(result.coreEvidencePass, false);
  assert.ok(result.missingCriticalEvidence.includes("discoveryEvidence"));
  const continuation = calculateMultiDayContinuationScore({ multiDayAccumulation: {
    seenDays: ["2025-01-02", "2025-01-03", "2025-01-06", "2025-01-07"], persistenceScore: 90, supportHoldingScore: 90 } }, { now });
  assert.equal(continuation.sessionEvidenceVerified, false);
  assert.equal(continuation.tier, "INTRADAY_ONLY");
});

test("learning rejects stale momentum baselines and pre-target crypto prices", () => {
  const baseline = { symbol: "BTC/USD", price: 100, changePercent: 1, liveQuoteUpdatedAt: iso() };
  const state = updateQuietCandidateOutcomes({}, [baseline], [baseline,
    { symbol: "OLD/USD", price: 1, changePercent: 99, liveQuoteUpdatedAt: iso(now - 86400000) }],
  { assetClass: "crypto", now, dayKey: iso().slice(0, 10) });
  assert.equal(state.observations[0].benchmarks.simpleMomentum.symbol, "BTC/USD");
  const later = now + 86400000;
  const result = updateQuietCandidateOutcomes(state, [], [{ ...baseline, price: 120, liveQuoteUpdatedAt: iso(later - 30000) }],
    { assetClass: "crypto", now: later, dayKey: iso(later).slice(0, 10) });
  assert.equal(result.observations[0].measurements[1], undefined);
  result.observations[0].benchmarks.simpleMomentum.symbol = "ETH/USD";
  assert.ok(getQuietFollowupSymbols(result, { now: later }).includes("ETH/USD"));
});

test("body download stops at byte budget and slow body deadline", async () => {
  await assert.rejects(readBoundedResponseText(new Response("x".repeat(200)), { maxBytes: 100 }), /budget/);
  const stream = new ReadableStream({ start() {} });
  await assert.rejects(readBoundedResponseText(new Response(stream), { timeoutMs: 10 }), /deadline/);
});

test("stored histories reject malformed rows, duplicate sessions and arbitrary payloads", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "smartmoney-history-bounds-"));
  try {
    const store = createDiscoveryFeatureStore({ directory });
    const day = "2026-09-04";
    const bar = { s: "SAFE", d: day, o: 10, h: 11, l: 9, c: 10, v: 100 };
    store.writeDaily(day, [bar, { ...bar, c: 10.5, debug: "x".repeat(10000) }, { ...bar, s: "BAD", h: 1 }]);
    let result = await store.readRecentHistories();
    assert.equal(result.rowsRead, 1);
    assert.equal(result.histories.get("SAFE")[0].debug, undefined);
    // Simulate an old/corrupted on-disk file, not a provider or live service.
    fs.appendFileSync(path.join(directory, `${day}.jsonl`), `not-json\n${JSON.stringify(bar)}\n`);
    result = await store.readRecentHistories();
    assert.equal(result.rowsRead, 1);
    fs.writeFileSync(path.join(directory, "2026-09-03.jsonl"), "x".repeat(4 * 1024 * 1024 + 1));
    result = await store.readRecentHistories();
    assert.equal(result.skippedFiles, 1);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("learning reports measured, missed and pending denominators without claiming full coverage", () => {
  const result = summarizeQuietCandidateOutcomes({ observations: [
    { assetClass: "crypto", evidenceVersion: 2, measurements: { 1: { evidenceVerified: true, measurementPolicyVersion: 3, peakReturnPercent: 2 } } },
    { assetClass: "crypto", evidenceVersion: 2, measurements: { 1: { status: "MISSED_TARGET_WINDOW" } } },
    { assetClass: "crypto", evidenceVersion: 2, measurements: {} },
  ] });
  assert.equal(result.crypto.horizons[1].trackedCount, 3);
  assert.equal(result.crypto.horizons[1].measuredCount, 1);
  assert.equal(result.crypto.horizons[1].missedCount, 1);
  assert.equal(result.crypto.horizons[1].pendingCount, 1);
  assert.match(result.crypto.horizons[1].denominatorScope, /NOT_FULL/);
});

test("continuation does not join widely separated stock sessions", () => {
  const result = calculateMultiDayContinuationScore({ multiDayAccumulation: {
    persistenceScore: 95, supportHoldingScore: 95,
    seenDays: ["2026-08-03", "2026-08-04", "2026-08-05", "2026-09-04"],
  } }, { now: Date.parse("2026-09-07T14:00:00Z") });
  assert.equal(result.observedSessions, 1);
  assert.equal(result.tier, "INTRADAY_ONLY");
});

test("history bootstrap rotates past 40 failing symbols without rewriting daily data", async () => {
  const histories = new Map(Array.from({ length: 80 }, (_, i) => [`S${i}`, [{ s: `S${i}`, d: "2026-09-04" }]]));
  const store = { writeDaily: () => assert.fail("warmup must not rewrite daily data"),
    readRecentHistories: async () => ({ histories, rowsRead: 80, filesRead: 1 }), seedHistories() {}, stats: () => ({}) };
  const visited = [];
  for (let i = 0; i < 2; i++) await runBoundedQuietDiscovery({ dateKey: "2026-09-04", featureStore: store,
    skipDailyWrite: true, now: () => now, bootstrapHistories: async (symbols) => { visited.push(...symbols); return []; } });
  assert.equal(new Set(visited).size, 80);
});

test("coordinated cache capacity retains 120 active quotes and pins owned symbols", () => {
  const rows = Object.fromEntries(Array.from({ length: 250 }, (_, i) => [`S${i}`, { updatedAt: iso(), price: 10 }]));
  const state = { liveQuoteCache: { ...rows }, liveMarketMemory: { ...rows } };
  cleanupLiveQuoteCache({ engineState: state, maxSymbols: 240, pinnedSymbols: ["S249"], maxAgeMinutes: 10 });
  assert.equal(Object.keys(state.liveQuoteCache).length, 240);
  assert.ok(state.liveQuoteCache.S249);
  const fresh120 = { liveQuoteCache: Object.fromEntries(Object.entries(rows).slice(0, 120)), liveMarketMemory: {} };
  cleanupLiveQuoteCache({ engineState: fresh120, maxSymbols: 240 });
  assert.equal(Object.keys(fresh120.liveQuoteCache).length, 120);
});

test("automatic selection rejects stored F85 with current weak evidence or revoked size", async () => {
  const submissions = [];
  const strategy = createAutoBuyStrategies({
    CONFIG: { maxCryptoOpenTrades: 3, maxOpenTrades: 8, maxBotExposurePercent: 80,
      cryptoMaxExposureShareOfBotExposure: 30, minCryptoTradeAmount: 25 },
    engineState: { aiManagedSymbols: [], lastSoldAt: {}, tradeMemory: {} }, getTradingMode: () => "smart",
    getAccount: async () => ({ cash: 1000, equity: 1000, crypto_buying_power: 1000 }),
    getPositions: async () => [], getBotOwnedSymbols: async () => new Set(), isAiManagedOpenPosition: () => false,
    normalizeSymbol: (s) => s.toUpperCase(), getDynamicTradeAmount: () => 100,
    getCryptoAvailableBuyingPower: () => 1000, getBotExposure: () => 0, isCrypto: () => true,
    passesInstitutionalOrchestratorBuyGate: () => ({ allowed: true }), passesAutonomousParliamentGate: () => ({ allowed: true, multiplier: 1 }),
    shouldSkipFromTradeMemory: () => false, calculateAdaptiveCryptoPositionSize: () => ({ recommendedAmount: 100 }),
    calculateFinalMasterDecisionProfile: () => ({ finalScore: 75, finalSizingMultiplier: 1, suppressEntry: false, finalExitProfile: {} }),
    markAiManagedSymbol() {}, journalTradeEntry() {}, recordOrder() {}, recordFailedOrder() {},
    executeAdaptiveBuyOrder: async (...args) => { submissions.push(args); return { ok: true }; },
  });
  await strategy.autoBuyCryptoSignals([crypto()]);
  assert.equal(submissions.length, 1, "complete current evidence reaches the stubbed broker");
  await strategy.autoBuyCryptoSignals([crypto({ bid: 99.6, ask: 100.4, multiDayContinuationScore: 60,
    cryptoDiscoveryScorecard: { score: 60, coverage: 1, calculatedAt: iso(), extension: { alreadyExtended: false } } })]);
  await strategy.autoBuyCryptoSignals([crypto({ recommendedTradeAmount: 0, rawRecommendedTradeAmount: 125 })]);
  assert.equal(submissions.length, 1, "neither weaker evidence nor historical sizing may reach submission");
});

test("provider refresh demotes old crypto approval without inventing a new decision time", async () => {
  const original = crypto();
  const refresh = createCryptoExecutionQuoteRefresher({
    normalizeSymbol: (s) => s.toUpperCase(),
    getLatestQuotes: async () => [{ ...original, bid: 99.6, ask: 100.4, spreadPercent: 0.8 }],
    updateQuoteCache: (_symbol, quote) => quote,
  });
  const [row] = await refresh([original]);
  assert.ok(row.cryptoDecisionScore < 65);
  assert.equal(row.approved, false);
  assert.equal(row.finalApprovedTradeAmount, 0);
  assert.equal(row.decisionUpdatedAt, original.decisionUpdatedAt);
});

test("repeated cache cleanup remains bounded without churning a 120-symbol active set", () => {
  const state = { liveQuoteCache: {}, liveMarketMemory: {} };
  for (let cycle = 0; cycle < 1000; cycle++) {
    for (let i = 0; i < 120; i++) {
      state.liveQuoteCache[`A${i}`] = { price: 100, updatedAt: iso(), priceIsLive: true };
      state.liveMarketMemory[`A${i}`] ||= { updatedAt: iso(), tickWindow: [], minuteCandles: [], secondCandles: [] };
      state.liveMarketMemory[`A${i}`].tickWindow.push({ price: 100 });
    }
    state.liveQuoteCache[`OLD${cycle}`] = { price: 50, updatedAt: iso(now - 1000) };
    cleanupLiveQuoteCache({ engineState: state, maxSymbols: 240 });
  }
  assert.ok(Object.keys(state.liveQuoteCache).length <= 240);
  assert.equal(Object.keys(state.liveMarketMemory).length, 120);
  for (let i = 0; i < 120; i++) {
    assert.ok(state.liveQuoteCache[`A${i}`]);
    assert.equal(state.liveMarketMemory[`A${i}`].tickWindow.length, 50);
  }
});
