import test from "node:test";
import assert from "node:assert/strict";
import { createCryptoMarketScanner } from "../strategies/cryptoMarketScanner.js";
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
      o: base,
      h: base + range * 0.65,
      l: base - range * 0.35,
      c: base + 0.12,
      v: index < 25 ? 10_000 : 6_500,
    };
  });
  const intradayBars = Array.from({ length: 12 }, (_, index) => ({
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
  assert.equal(engineState.cryptoQuietDiscoveryState.selectedCount, 1);
  assert.equal(engineState.cryptoQuietDiscoveryState.topCandidates[0].chartBars, undefined);
});
