import test from "node:test";
import assert from "node:assert/strict";
import {
  createCryptoMarketScanner,
  mapWithConcurrency,
  mergeLatestCryptoPriceWithAlpacaSpread,
  resolveCryptoDailyChangeReference,
} from "../strategies/cryptoMarketScanner.js";
import { calculateCryptoLiquidityFromBars } from "../scoring/cryptoScoring.js";

const clampScore = (value) => Math.max(0, Math.min(100, Number(value) || 0));

function createScanner() {
  return createCryptoMarketScanner({
    CONFIG: { minScoreToBuy: 70 },
    calculateRunnerHoldQuality: () => ({
      runnerHoldApproved: true,
      runnerHoldScore: 80,
    }),
    calculateRunnerStageProfile: () => ({
      runnerStage: "EARLY",
      lateChaseRisk: false,
    }),
    clampScore,
  });
}

function flatBars(length) {
  return Array.from({ length }, () => ({
    o: 100,
    h: 100,
    l: 100,
    c: 100,
    v: 10,
  }));
}

test("flat history stays neutral and extra bars do not create bullish points", () => {
  const { scoreCrypto } = createScanner();
  const shortHistoryScore = scoreCrypto({ current: 100 }, flatBars(3));
  const fullHistoryScore = scoreCrypto({ current: 100 }, flatBars(30));

  assert.ok(fullHistoryScore <= 55);
  assert.equal(fullHistoryScore, shortHistoryScore);
});

test("a sub-0.05 percent drift cannot accumulate correlated trend bonuses", () => {
  const { scoreCrypto } = createScanner();
  const bars = Array.from({ length: 30 }, (_, index) => {
    const open = 100 + index * 0.001;
    return {
      o: open,
      h: open + 0.006,
      l: open - 0.005,
      c: open + 0.0005,
      v: 10,
    };
  });
  const current = bars[bars.length - 1].c;
  const driftPercent = ((current - bars[0].o) / bars[0].o) * 100;
  const score = scoreCrypto({ current }, bars);

  assert.ok(driftPercent > 0 && driftPercent < 0.05);
  assert.ok(score < 65);
});

test("meaningful trend with expanding volume outranks flat and tiny drift", () => {
  const { scoreCrypto } = createScanner();
  const flatScore = scoreCrypto({ current: 100 }, flatBars(30));
  const tinyDriftBars = Array.from({ length: 30 }, (_, index) => {
    const open = 100 + index * 0.001;
    return { o: open, h: open + 0.006, l: open - 0.005, c: open + 0.0005, v: 10 };
  });
  const tinyDriftScore = scoreCrypto(
    { current: tinyDriftBars[tinyDriftBars.length - 1].c },
    tinyDriftBars
  );
  const trendingBars = Array.from({ length: 30 }, (_, index) => {
    const open = 100 + index * 0.07;
    return {
      o: open,
      h: open + 0.08,
      l: open - 0.02,
      c: open + 0.06,
      v: index === 29 ? 40 : 10,
    };
  });
  const trendScore = scoreCrypto(
    { current: trendingBars[trendingBars.length - 1].c },
    trendingBars
  );

  assert.ok(trendScore > flatScore);
  assert.ok(trendScore > tinyDriftScore);
  assert.ok(trendScore - Math.max(flatScore, tinyDriftScore) >= 15);
});

test("zero-valued aliases do not hide later positive scanner inputs", () => {
  const { scoreCrypto } = createScanner();
  const canonicalBars = Array.from({ length: 20 }, (_, index) => {
    const open = 100 + index * 0.05;
    return { o: open, h: open + 0.07, l: open - 0.02, c: open + 0.05, v: 10 };
  });
  const aliasBars = canonicalBars.map((bar) => ({
    o: 0,
    open: bar.o,
    h: 0,
    high: bar.h,
    l: 0,
    low: bar.l,
    c: 0,
    close: bar.c,
    v: 0,
    volume: bar.v,
  }));
  const current = canonicalBars[canonicalBars.length - 1].c;

  assert.equal(
    scoreCrypto({ current: 0, price: current }, aliasBars),
    scoreCrypto({ current }, canonicalBars)
  );
});

test("crypto scan publishes quiet discovery separately from legacy momentum", async () => {
  const dailyBars = Array.from({ length: 30 }, (_, index) => {
    const base = 100 + index * 0.08;
    const range = index < 25 ? 1.2 : 0.35;
    return {
      t: new Date(Math.floor(Date.now() / 86400000) * 86400000 - (30 - index) * 86400000).toISOString(),
      o: base,
      h: base + range * 0.65,
      l: base - range * 0.35,
      c: base + 0.12,
      v: index < 25 ? 10_000 : 6_500,
    };
  });
  const intradayBars = Array.from({ length: 12 }, (_, index) => ({
    t: new Date(Date.now() - (12 - index) * 300000).toISOString(),
    o: 102.4 + index * 0.01,
    h: 102.45 + index * 0.01,
    l: 102.35 + index * 0.01,
    c: 102.42 + index * 0.01,
    v: index === 11 ? 17_000 : 10_000,
  }));
  const engineState = {};
  const scanner = createCryptoMarketScanner({
    CONFIG: { minScoreToBuy: 70 },
    calculateCryptoLiquidityFromBars,
    calculateRunnerHoldQuality: () => ({ runnerHoldApproved: true, runnerHoldScore: 80 }),
    calculateRunnerStageProfile: () => ({ runnerStage: "EARLY", lateChaseRisk: false }),
    clampScore,
    engineState,
    getBestCryptoBars: async () => intradayBars,
    getCryptoDailyBarsForDiscovery: async () => dailyBars,
    getCryptoAssets: async () => ["BTC/USD"],
    getCryptoLatestQuote: async () => ({
      symbol: "BTC/USD",
      current: dailyBars.at(-1).c,
      bid: dailyBars.at(-1).c - 0.02,
      ask: dailyBars.at(-1).c + 0.02,
      dollarVolume24h: 10_000_000,
      quoteFetchedAt: "2026-08-31T14:00:00.000Z",
      liveQuoteSource: "alpaca_crypto_latest",
      priceIsLive: true,
    }),
    getCryptoNewsIntelligence: async () => ({
      dataAvailable: true,
      catalystAvailable: false,
      riskDetected: false,
    }),
    getFreshLiveCryptoQuote: () => null,
    isCrypto: () => true,
    recordSkippedSymbol: () => {},
    updateQuoteCache: (_symbol, quote) => ({
      ...quote,
      liveQuoteUpdatedAt: quote.quoteFetchedAt,
      updatedAt: quote.quoteFetchedAt,
      spreadUpdatedAt: quote.quoteFetchedAt,
      bidAskUpdatedAt: quote.quoteFetchedAt,
      spreadSource: quote.liveQuoteSource,
      priceIsLive: true,
    }),
    getRuntime: () => ({ TRADING_MODE: "live_crypto", LIVE_ORDER_MAX_QUOTE_AGE_SECONDS: 15 }),
  });

  const [signal] = await scanner.scanCryptoMarket();

  assert.ok(signal.cryptoDiscoveryScore >= 70);
  assert.equal(signal.cryptoDiscoveryScore, signal.rawCryptoScore);
  assert.equal(typeof signal.legacyMomentumScore, "number");
  assert.equal(signal.cryptoDiscoveryScorecard.extension.alreadyExtended, false);
  assert.equal(signal.liveQuoteUpdatedAt, "2026-08-31T14:00:00.000Z");
  assert.equal(signal.spreadUpdatedAt, "2026-08-31T14:00:00.000Z");
  assert.equal(signal.priceIsLive, true);
  assert.equal(signal.multiDayScoreAvailable, true);
  assert.equal(signal.continuationScorecard.available, true);
  const quietSnapshot = engineState.cryptoQuietDiscoveryState;
  const scanStartedAt = engineState.lastCryptoScanStartedAt;
  const stage = engineState.engineCycleStage;
  const [review] = await scanner.analyzeCryptoCandidates(['BTC/USD', 'NOTTRADABLE/USD']);
  assert.equal(review.symbol, 'BTC/USD');
  assert.equal(review.cryptoDiscoveryScore, signal.cryptoDiscoveryScore);
  assert.equal(review.multiDayScoreAvailable, true);
  assert.equal(review.approved, false);
  assert.equal(review.autoTradeApproved, false);
  assert.equal(review.finalApprovedTradeAmount, 0);
  assert.equal(engineState.cryptoQuietDiscoveryState, quietSnapshot);
  assert.equal(engineState.lastCryptoScanStartedAt, scanStartedAt);
  assert.equal(engineState.engineCycleStage, stage);
  assert.equal(signal.continuationScorecard.observedSessions, 8);
  assert.equal(engineState.cryptoQuietDiscoveryState.selectedCount, 1);
  assert.equal(engineState.cryptoQuietDiscoveryState.topCandidates[0].chartBars, undefined);
});

test("crypto scanner publishes a flat bar-window move as authoritative measured zero", async () => {
  const bars = Array.from({ length: 12 }, (_, index) => ({
    t: `2026-08-31T14:${String(index).padStart(2, "0")}:00.000Z`,
    o: 100,
    h: 100.1,
    l: 99.9,
    c: 100,
    v: 10_000,
  }));
  let cachedInput = null;
  const scanner = createCryptoMarketScanner({
    CONFIG: { minScoreToBuy: 70 },
    calculateCryptoLiquidityFromBars,
    calculateRunnerHoldQuality: () => ({ runnerHoldApproved: true, runnerHoldScore: 80 }),
    calculateRunnerStageProfile: () => ({ runnerStage: "EARLY", lateChaseRisk: false }),
    clampScore,
    engineState: {},
    getBestCryptoBars: async () => bars,
    getCryptoDailyBarsForDiscovery: async () => [],
    getCryptoAssets: async () => ["BTC/USD"],
    getCryptoLatestQuote: async () => ({
      symbol: "BTC/USD",
      current: 100,
      bid: 99.99,
      ask: 100.01,
      percentChange: null,
      percentChangeAvailable: false,
      quoteFetchedAt: "2026-08-31T14:12:00.000Z",
      liveQuoteSource: "alpaca_crypto_latest",
      priceIsLive: true,
    }),
    getCryptoNewsIntelligence: async () => ({ dataAvailable: false }),
    getFreshLiveCryptoQuote: () => null,
    isCrypto: () => true,
    recordSkippedSymbol: () => {},
    updateQuoteCache: (_symbol, quote) => {
      cachedInput = quote;
      return {
        ...quote,
        liveQuoteUpdatedAt: quote.quoteFetchedAt,
        spreadUpdatedAt: quote.spreadUpdatedAt,
        priceIsLive: true,
      };
    },
    getRuntime: () => ({
      TRADING_MODE: "live_crypto",
      LIVE_ORDER_MAX_QUOTE_AGE_SECONDS: 15,
      CRYPTO_SCAN_CONCURRENCY: 2,
    }),
  });

  const [signal] = await scanner.scanCryptoMarket();

  assert.equal(signal.percentChange, 0);
  assert.equal(signal.percentChangeAvailable, true);
  assert.equal(signal.percentChangeReferencePrice, 100);
  assert.equal(signal.percentChangeReferenceType, "intraday_window_open");
  assert.equal(cachedInput.percentChange, 0);
  assert.equal(cachedInput.percentChangeAvailable, true);
});

test("crypto scan worker pool is concurrent and respects its bound", async () => {
  let active = 0;
  let maxActive = 0;
  const completed = [];
  await mapWithConcurrency([1, 2, 3, 4, 5, 6], 3, async (value) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    completed.push(value);
    active -= 1;
  });

  assert.equal(maxActive, 3);
  assert.deepEqual(completed.sort((a, b) => a - b), [1, 2, 3, 4, 5, 6]);
});

test("crypto day change prefers a completed timestamped UTC daily close", () => {
  const reference = resolveCryptoDailyChangeReference(
    [
      {
        t: "2026-08-30T00:00:00.000Z",
        o: 98,
        h: 102,
        l: 97,
        c: 100,
        source: "alpaca_crypto_bars",
      },
      {
        t: "2026-08-31T00:00:00.000Z",
        o: 101,
        h: 104,
        l: 100,
        c: 103,
        source: "alpaca_crypto_bars",
      },
    ],
    { now: new Date("2026-08-31T14:00:00.000Z") }
  );

  assert.deepEqual(reference, {
    price: 100,
    type: "previous_completed_utc_daily_close",
    source: "alpaca_crypto_bars",
    dayKey: "2026-08-30",
  });
});

test("newest crypto trade price can use an independently fresh Alpaca spread", () => {
  const merged = mergeLatestCryptoPriceWithAlpacaSpread(
    {
      current: 101,
      price: 101,
      liveQuoteUpdatedAt: "2026-08-31T14:00:04.000Z",
      liveQuoteSource: "finnhub_ws_trade",
      priceIsLive: true,
    },
    {
      current: 100.5,
      price: 100.5,
      bid: 100.49,
      ask: 100.51,
      liveQuoteUpdatedAt: "2026-08-31T14:00:03.000Z",
      spreadUpdatedAt: "2026-08-31T14:00:03.000Z",
      spreadSource: "alpaca_crypto_latest",
      liveQuoteSource: "alpaca_crypto_latest",
      priceIsLive: true,
    },
    {
      now: Date.parse("2026-08-31T14:00:05.000Z"),
      maxSpreadAgeSeconds: 5,
    }
  );

  assert.equal(merged.current, 101);
  assert.equal(merged.liveQuoteSource, "finnhub_ws_trade");
  assert.equal(merged.bid, 100.49);
  assert.equal(merged.ask, 100.51);
  assert.equal(merged.spreadAvailable, true);
  assert.equal(merged.spreadSource, "alpaca_crypto_latest");
});

test("scanner reruns its existing qualification with one final batched Alpaca spread", async () => {
  const timestamp = new Date().toISOString();
  const dailyBars = Array.from({ length: 30 }, (_, index) => {
    const base = 100 + index * 0.08;
    const range = index < 25 ? 1.2 : 0.35;
    return {
      o: base,
      h: base + range * 0.65,
      l: base - range * 0.35,
      c: base + 0.12,
      v: index < 25 ? 10_000 : 6_500,
    };
  });
  const intradayBars = Array.from({ length: 12 }, (_, index) => ({
    t: Date.now() - (12 - index) * 300000,
    o: 102.4 + index * 0.01,
    h: 102.45 + index * 0.01,
    l: 102.35 + index * 0.01,
    c: 102.42 + index * 0.01,
    v: index === 11 ? 17_000 : 10_000,
  }));
  let batchCalls = 0;
  const scanner = createCryptoMarketScanner({
    CONFIG: { minScoreToBuy: 70 },
    calculateCryptoLiquidityFromBars,
    calculateRunnerHoldQuality: () => ({ runnerHoldApproved: true, runnerHoldScore: 80 }),
    calculateRunnerStageProfile: () => ({ runnerStage: "EARLY", lateChaseRisk: false }),
    clampScore,
    engineState: {},
    getBestCryptoBars: async () => intradayBars,
    getCryptoDailyBarsForDiscovery: async () => dailyBars,
    getCryptoAssets: async () => ["BTC/USD"],
    getCryptoLatestQuote: async () => {
      throw new Error("per-symbol quote request should not run");
    },
    getCryptoLatestQuotes: async () => {
      batchCalls += 1;
      return [{
        symbol: "BTC/USD",
        current: dailyBars.at(-1).c,
        price: dailyBars.at(-1).c,
        bid: dailyBars.at(-1).c - 0.02,
        ask: dailyBars.at(-1).c + 0.02,
        spreadAvailable: true,
        spreadUpdatedAt: timestamp,
        bidAskUpdatedAt: timestamp,
        spreadSource: "alpaca_crypto_latest",
        quoteFetchedAt: timestamp,
        liveQuoteUpdatedAt: timestamp,
        liveQuoteSource: "alpaca_crypto_latest",
        source: "alpaca_crypto_latest",
        priceIsLive: true,
      }];
    },
    getCryptoNewsIntelligence: async () => ({ dataAvailable: false, riskDetected: false }),
    getFreshLiveCryptoQuote: () => ({
      symbol: "BTC/USD",
      current: dailyBars.at(-1).c + 0.01,
      price: dailyBars.at(-1).c + 0.01,
      liveQuoteUpdatedAt: timestamp,
      quoteFetchedAt: timestamp,
      liveQuoteSource: "finnhub_ws_trade",
      source: "finnhub_ws_trade",
      priceIsLive: true,
    }),
    isCrypto: () => true,
    recordSkippedSymbol: () => {},
    updateQuoteCache: (_symbol, quote) => ({
      ...quote,
      spread: quote.spreadAvailable ? Number((quote.ask - quote.bid).toFixed(4)) : null,
      spreadPercent: quote.spreadAvailable
        ? ((quote.ask - quote.bid) / ((quote.ask + quote.bid) / 2)) * 100
        : null,
      updatedAt: quote.liveQuoteUpdatedAt,
    }),
    getRuntime: () => ({
      TRADING_MODE: "live_crypto",
      LIVE_ORDER_MAX_QUOTE_AGE_SECONDS: 15,
      CRYPTO_SCAN_CONCURRENCY: 2,
    }),
  });

  const [signal] = await scanner.scanCryptoMarket();

  assert.equal(batchCalls, 2);
  assert.equal(signal.spreadAvailable, true);
  assert.equal(signal.spreadSource, "alpaca_crypto_latest");
  assert.equal(signal.cryptoEntryScorecard.available, true);
  assert.equal(signal.cryptoInstitutionalQualification.spreadPass, true);
  assert.equal(
    signal.autoTradeApproved,
    signal.cryptoInstitutionalQualification.passed
  );
});
