import test from "node:test";
import assert from "node:assert/strict";
import {
  buildStockDiscoveryFunnel,
  executionQuoteDecision,
  filterStaticUniverse,
  mergeSweepWithDeepScores,
  newsPromotion,
  rankTradierSweep,
  rotateSweep,
} from "../discovery/stockRealtimePipeline.js";
import { normalizeTradierQuote } from "../providers/tradierMarketData.js";
import { createMarketPriorityQueue } from "../discovery/marketPriorityQueue.js";
import { scopedRelativeVolume, stockFeedProvenance } from "../market-data/feedContract.js";

const now = Date.parse("2026-09-25T14:00:00.000Z");

test("a static filter keeps a broad equity universe and names each drop", () => {
  const result = filterStaticUniverse([
    { symbol: "AAA", assetClass: "us_equity", tradable: true, previousClose: 12, averageVolume: 200000 },
    { symbol: "bbb", assetClass: "stock", previousClose: 8, averageVolume: 90000 },
    { symbol: "OLD", status: "inactive", previousClose: 10 },
    { symbol: "OPT", assetClass: "option", previousClose: 2 },
    { symbol: "PENNY", previousClose: 0.2, averageVolume: 90000 },
    { symbol: "THIN", previousClose: 10, averageVolume: 1000 },
    { symbol: "1BAD" },
  ]);
  assert.equal(result.broadUniverseCount, 7);
  assert.equal(result.staticFilterPassedCount, 2);
  assert.deepEqual(result.symbols, ["AAA", "BBB"]);
  assert.equal(result.rejections.find((row) => row.symbol === "PENNY").reason, "PRICE_FILTER");
  assert.equal(result.rejections.find((row) => row.symbol === "THIN").reason, "VOLUME_FILTER");
  assert.ok(result.staticFilterPassedCount > 1);
});

test("Massive delayed data cannot satisfy execution freshness", () => {
  const delayed = executionQuoteDecision({ provider: "MASSIVE", feed: "DELAYED", timing: "DELAYED", ageMs: 1000 });
  assert.equal(delayed.satisfiesExecution, false);
  assert.equal(delayed.reason, "DELAYED_FEED");
  assert.equal(delayed.changesFinalScore, false);
});

test("a Tradier brokerage quote is tagged real-time consolidated and keeps bid and ask size", () => {
  const quote = normalizeTradierQuote({
    symbol: "AAA",
    type: "stock",
    bid: 10,
    ask: 10.02,
    bidsize: 300,
    asksize: 400,
    last: 10.01,
    bid_date: now,
    ask_date: now,
    trade_date: now,
    volume: 250000,
    prevclose: 9.5,
  }, { now: now + 1000 });
  assert.equal(quote.liveQuoteSource, "tradier_stock_quote");
  assert.equal(quote.bidSizeShares, 30000);
  assert.equal(quote.askSizeShares, 40000);
  const ranked = rankTradierSweep([{ ...quote, provider: "TRADIER", feed: "REALTIME_CONSOLIDATED" }]);
  assert.equal(ranked.ranked[0].provider, "TRADIER");
  assert.equal(ranked.ranked[0].feed, "REALTIME_CONSOLIDATED");
  assert.equal(ranked.ranked[0].bid, 10);
  assert.equal(ranked.ranked[0].ask, 10.02);
});

test("a missing Tradier quote stays unavailable and does not become a bad score", () => {
  const ranked = rankTradierSweep([{ symbol: "AAA", provider: "TRADIER", source: "tradier_stock_quote", price: null, bid: null, ask: null }]);
  assert.equal(ranked.ranked.length, 0);
  assert.equal(ranked.rejections[0].reason, "NO_TRADIER_QUOTE");
  const missing = executionQuoteDecision({});
  assert.equal(missing.state, "DATA_UNAVAILABLE");
  assert.equal(missing.changesFinalScore, false);
});

test("a stale Tradier quote waits on execution and does not change F", () => {
  const stale = executionQuoteDecision({ provider: "TRADIER", feed: "CONSOLIDATED", ageMs: 14000, spreadPercent: 0.2 });
  assert.equal(stale.reason, "QUOTE_STALE");
  assert.equal(stale.changesFinalScore, false);
});

test("an IEX quote is not consolidated and cannot use an IEX volume baseline", () => {
  const iex = executionQuoteDecision({ provider: "ALPACA", feed: "IEX", ageMs: 1000, spreadPercent: 0.2 });
  assert.equal(iex.marketDataQuality, "SINGLE_EXCHANGE");
  assert.equal(iex.satisfiesExecution, false);
  const mixed = scopedRelativeVolume({
    currentVolume: 100,
    currentProvenance: stockFeedProvenance({ provider: "TRADIER", feed: "CONSOLIDATED" }),
    baselineVolume: 50,
    baselineProvenance: stockFeedProvenance({ provider: "ALPACA", feed: "IEX" }),
  });
  assert.equal(mixed.value, null);
  assert.equal(mixed.reason, "FEED_SCOPE_MISMATCH");
});

test("the quote sweep rotates through the universe instead of a fixed first page", () => {
  const symbols = Array.from({ length: 300 }, (_, index) => `S${index}`);
  const first = rotateSweep(symbols, 0, 120);
  const second = rotateSweep(symbols, first.nextCursor, 120);
  assert.equal(first.symbols.length, 120);
  assert.equal(first.symbols[0], "S0");
  assert.equal(second.symbols[0], "S120");
  assert.notEqual(second.symbols[0], first.symbols[0]);
});

test("a realtime mover enters the queue without a five minute scan and aging is kept", () => {
  const queue = createMarketPriorityQueue({ workerCapacity: 4 });
  const accepted = queue.ingestRealtimeMover({
    symbol: "NEW",
    realtime: true,
    measuredAt: new Date(now).toISOString(),
    percentChange: 4,
    volume: 300000,
  }, now);
  assert.equal(accepted.waitedForSwingScan, false);
  assert.equal(accepted.accepted, true);
  queue.accumulateSweep({
    now: now + 50000,
    cheapMovers: [
      { symbol: "NEW", percentChange: 4, volume: 300000, price: 10 },
      { symbol: "FRESH", percentChange: 8, volume: 300000, price: 10 },
    ],
  });
  const jobs = queue.nextDeepJobs(1, now + 50000);
  assert.equal(jobs[0], "NEW");
});

test("an open position does not consume the only discovery slot", () => {
  const queue = createMarketPriorityQueue({ workerCapacity: 2 });
  queue.accumulateSweep({
    now,
    cheapMovers: [{ symbol: "MOVER", percentChange: 3, volume: 200000, price: 10 }],
    openPositionSymbols: ["HELD"],
  });
  const jobs = queue.nextDeepJobs(2, now);
  assert.equal(jobs.includes("HELD"), true);
  assert.equal(jobs.includes("MOVER"), true);
});

test("Finnhub news can promote an unwatched symbol and a missing feed is not a negative score", () => {
  const promoted = newsPromotion({ symbol: "NEWS", headline: "contract win", providerAvailable: true, covered: true });
  assert.equal(promoted.promote, true);
  assert.equal(promoted.newsState, "POSITIVE_CATALYST");
  assert.equal(newsPromotion({ providerAvailable: false }).newsState, "NEWS_PROVIDER_UNAVAILABLE");
  assert.equal(newsPromotion({ providerAvailable: true, covered: false }).newsState, "NEWS_NOT_COVERED");
  assert.equal(newsPromotion({ providerAvailable: true, covered: true }).newsState, "NO_CATALYST");
});

test("the discovery funnel counts every stage and the deep queue is not the whole board", () => {
  const funnel = buildStockDiscoveryFunnel({
    broadUniverseCount: 8642,
    staticFilterPassedCount: 1184,
    sweepRequested: 120,
    tradierQuotes: 110,
    cheapCandidates: 90,
    streamingSymbols: 40,
    queueDepth: 90,
    deepScored: 4,
    rejections: [{ reason: "NO_TRADIER_QUOTE" }, { reason: "PRICE_FILTER" }],
  });
  assert.equal(funnel.broadUniverse, 8642);
  assert.equal(funnel.staticFilterPassed, 1184);
  assert.equal(funnel.priorityQueue, 90);
  assert.equal(funnel.deepScored, 4);
  assert.equal(funnel.fixedShortlist, false);
  assert.equal(funnel.rejections.NO_TRADIER_QUOTE, 1);
  const board = mergeSweepWithDeepScores(
    [{ symbol: "AAA", price: 10 }, { symbol: "BBB", price: 11 }, { symbol: "CCC", price: 12 }],
    [{ symbol: "BBB", stockDecisionScore: 74 }]
  );
  assert.equal(board.length, 3);
  assert.equal(board.find((row) => row.symbol === "BBB").stockDecisionScore, 74);
});
