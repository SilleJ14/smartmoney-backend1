import test from "node:test";
import assert from "node:assert/strict";
import { buildLiveMovers } from "../market-data/liveMovers.js";

const normalizeSymbol = (symbol) => String(symbol || "").toUpperCase();
const isCrypto = (symbol) => symbol.includes("/") || symbol.endsWith("USD");

test("buildLiveMovers uses stock scoring fields for stocks and crypto fields for crypto", () => {
  const movers = buildLiveMovers({
    state: {
      topStockSignals: [{ symbol: "AAPL", price: 110, previousClose: 100, runnerScore: 92, cryptoLiquidityScore: 99 }],
      topCryptoSignals: [{ symbol: "BTC/USD", price: 105, previousClose: 100, runnerScore: 97, cryptoLiquidityScore: 88 }],
    },
    normalizeSymbol,
    mergeLiveQuote: (signal) => signal,
    isCrypto,
    now: () => new Date("2026-01-01T00:00:00Z"),
  });

  assert.equal(movers.find((mover) => mover.symbol === "AAPL").score, 92);
  assert.equal(movers.find((mover) => mover.symbol === "BTC/USD").score, 88);
});

test("buildLiveMovers deduplicates symbols and keeps the largest absolute move", () => {
  const movers = buildLiveMovers({
    state: {
      topStockSignals: [{ symbol: "AAPL", price: 102, previousClose: 100 }],
      lastStockSignals: [{ symbol: "aapl", price: 90, previousClose: 100 }],
    },
    limit: 10,
    normalizeSymbol,
    mergeLiveQuote: (signal) => signal,
    isCrypto,
  });

  assert.equal(movers.length, 1);
  assert.equal(movers[0].changePercent, -10);
});

test("live movers preserve provider quote time and never manufacture live freshness", () => {
  const providerTime = "2026-08-27T14:30:00.000Z";
  const movers = buildLiveMovers({
    state: {
      topStockSignals: [{
        symbol: "AAPL",
        price: 110,
        previousClose: 100,
        priceIsLive: false,
      }],
      liveQuoteCache: {
        AAPL: {
          price: 111,
          bid: 110.9,
          ask: 111.1,
          spreadPercent: 0.18,
          spreadAvailable: true,
          liveQuoteUpdatedAt: providerTime,
          liveQuoteSource: "alpaca_latest_stock_quote",
          priceIsLive: true,
        },
      },
    },
    normalizeSymbol,
    mergeLiveQuote: (signal) => signal,
    isCrypto,
    now: () => new Date("2026-08-27T15:00:00.000Z"),
  });

  assert.equal(movers[0].liveQuoteUpdatedAt, providerTime);
  assert.equal(movers[0].spreadAvailable, true);
  assert.equal(movers[0].priceIsLive, true);
  assert.equal(movers[0].liveQuoteFresh, false);
  assert.equal(movers[0].entryQualityScoreAvailable, false);
  assert.equal(movers[0].stockDecisionScoreAvailable, false);

  const snapshot = buildLiveMovers({
    state: { topStockSignals: [{ symbol: "MSFT", price: 200, previousClose: 190 }] },
    normalizeSymbol,
    mergeLiveQuote: (signal) => signal,
    isCrypto,
    now: () => new Date("2026-08-27T15:00:00.000Z"),
  });
  assert.equal(snapshot[0].liveQuoteUpdatedAt, null);
  assert.equal(snapshot[0].liveQuoteSource, "scan_snapshot");
  assert.equal(snapshot[0].priceIsLive, false);
  assert.equal(snapshot[0].spreadAvailable, false);
});

test("live movers preserve and refresh authoritative stock D E and F fields", () => {
  const now = new Date("2026-08-31T15:00:00.000Z");
  const movers = buildLiveMovers({
    state: {
      marketOpen: true,
      topStockSignals: [{
        symbol: "AAPL",
        price: 103,
        previousClose: 100,
        preMoveScore: 82,
        historyDays: 30,
        extensionProfile: { coverage: 1, alreadyExtended: false, extensionPenalty: 0 },
        technicalBarsFound: 30,
        technicals: { ema9: 103, ema20: 101, macd: 2, macdSignal: 1, rsi: 61 },
        confirmations: {
          closeNearHighPercent: 86,
          aboveVwap: true,
          fakeBreakout: false,
        },
        phase5SignalQuality: {
          breakoutRetestConfirmation: true,
          liquidityStabilityScore: 88,
          antiChaseRisk: 18,
          exhaustionRisk: 14,
          spreadWideningRisk: 10,
        },
        contextScore: 76,
        blendedRiskScore: 82,
        portfolioScore: 78,
        fundamentalBlendScore: 74,
        fundamentalDataValid: true,
        masterFinalScore: 79,
        entryQualityScore: 77,
        discoveryScore: 80,
      }],
      liveQuoteCache: {
        AAPL: {
          price: 103,
          bid: 102.98,
          ask: 103.02,
          spreadAvailable: true,
          spreadPercent: 0.0388,
          spreadUpdatedAt: now.toISOString(),
          liveQuoteUpdatedAt: now.toISOString(),
          liveQuoteSource: "alpaca_latest_stock_quote",
          priceIsLive: true,
        },
      },
    },
    normalizeSymbol,
    mergeLiveQuote: (signal) => ({
      ...signal,
      bid: 102.98,
      ask: 103.02,
      spreadAvailable: true,
      spreadPercent: 0.0388,
      spreadUpdatedAt: now.toISOString(),
      liveQuoteUpdatedAt: now.toISOString(),
      liveQuoteSource: "alpaca_latest_stock_quote",
      priceIsLive: true,
    }),
    isCrypto,
    now: () => now,
  });

  assert.equal(movers[0].liveScoreRefresh, true);
  assert.equal(movers[0].marketOpen, true);
  assert.equal(movers[0].discoveryScoreAvailable, true);
  assert.equal(movers[0].entryQualityScoreAvailable, true);
  assert.equal(movers[0].stockDecisionScoreAvailable, true);
  assert.ok(Number.isFinite(movers[0].discoveryScore));
  assert.ok(Number.isFinite(movers[0].entryQualityScore));
  assert.ok(Number.isFinite(movers[0].stockDecisionScore));
  assert.ok(movers[0].entryQualityScore > 0);
  assert.ok(movers[0].stockDecisionScore > 0);
  assert.equal(movers[0].masterFinalScore, 79, "existing central evidence is preserved");
});

test("live movers never copy Discovery into F when Entry evidence is unavailable", () => {
  const now = new Date("2026-08-31T15:00:00.000Z");
  const movers = buildLiveMovers({
    state: {
      marketOpen: true,
      topStockSignals: [{
        symbol: "XYZ",
        price: 103,
        previousClose: 100,
        preMoveScore: 67,
        historyDays: 30,
        extensionProfile: { coverage: 1, alreadyExtended: false, extensionPenalty: 0 },
        masterFinalScore: 67,
        discoveryScore: 67,
        entryQualityScore: 0,
      }],
      liveQuoteCache: {
        XYZ: {
          price: 103,
          bid: 102.98,
          ask: 103.02,
          spreadAvailable: true,
          spreadPercent: 0.0388,
          liveQuoteUpdatedAt: now.toISOString(),
          liveQuoteSource: "alpaca_latest_stock_quote",
          priceIsLive: true,
        },
      },
    },
    normalizeSymbol,
    mergeLiveQuote: (signal) => ({
      ...signal,
      bid: 102.98,
      ask: 103.02,
      spreadAvailable: true,
      spreadPercent: 0.0388,
      liveQuoteUpdatedAt: now.toISOString(),
      liveQuoteSource: "alpaca_latest_stock_quote",
      priceIsLive: true,
    }),
    isCrypto,
    now: () => now,
  });

  assert.equal(movers[0].discoveryScore, 67);
  assert.equal(movers[0].entryQualityScoreAvailable, false);
  assert.equal(movers[0].entryQualityScore, null);
  assert.equal(movers[0].stockDecisionScoreAvailable, false);
  assert.equal(movers[0].stockDecisionScore, null);
  assert.notEqual(movers[0].stockDecisionScore, movers[0].discoveryScore);
});

test("live movers do not finalize Entry from a fresh trade carrying stale bid/ask", () => {
  const now = new Date("2026-08-31T15:00:20.000Z");
  const signal = {
    symbol: "AAPL",
    price: 103,
    previousClose: 100,
    historyDays: 30,
    extensionProfile: { coverage: 1, alreadyExtended: false, extensionPenalty: 0 },
    technicalBarsFound: 30,
    technicals: { ema9: 103, ema20: 101, macd: 2, macdSignal: 1, rsi: 61 },
    confirmations: { closeNearHighPercent: 86, aboveVwap: true, fakeBreakout: false },
    phase5SignalQuality: {
      breakoutRetestConfirmation: true,
      liquidityStabilityScore: 88,
      antiChaseRisk: 18,
      exhaustionRisk: 14,
      spreadWideningRisk: 10,
    },
  };
  const movers = buildLiveMovers({
    state: {
      marketOpen: true,
      topStockSignals: [signal],
      liveQuoteCache: {
        AAPL: {
          price: 103,
          bid: 102.98,
          ask: 103.02,
          spreadAvailable: true,
          spreadPercent: 0.0388,
          liveQuoteUpdatedAt: now.toISOString(),
          spreadUpdatedAt: "2026-08-31T15:00:00.000Z",
          liveQuoteSource: "finnhub_ws_trade",
          spreadSource: "alpaca_latest_stock_quote",
          priceIsLive: true,
        },
      },
    },
    normalizeSymbol,
    mergeLiveQuote: (value) => value,
    isCrypto,
    now: () => now,
  });

  assert.equal(movers[0].liveQuoteFresh, true);
  assert.equal(movers[0].liveSpreadFresh, false);
  assert.equal(movers[0].entryQualityScoreAvailable, false);
});

test("live movers finalize crypto F when discovery entry context and quote evidence are complete", () => {
  const now = new Date("2026-08-31T15:00:00.000Z");
  const candidate = {
    symbol: "BTC/USD",
    price: 100,
    current: 100,
    bid: 99.95,
    ask: 100.05,
    spreadAvailable: true,
    spreadPercent: 0.1,
    spreadUpdatedAt: now.toISOString(),
    priceIsLive: true,
    liveQuoteUpdatedAt: now.toISOString(),
    liveQuoteSource: "alpaca_crypto_latest",
    cryptoDiscoveryScorecard: {
      score: 72,
      coverage: 1,
      calculatedAt: now.toISOString(),
      extension: { alreadyExtended: false },
    },
    cryptoContextScorecard: {
      independent: true,
      score: 68,
      source: "cross_asset_crypto_breadth",
    },
    newsCatalyst: { dataAvailable: true, riskDetected: false },
    barsFound: 30,
    windowDollarVolume: 2_000_000,
    multiDayContinuationScore: 70,
    multiDayAccumulation: { seenDays: ["2026-08-29", "2026-08-30"] },
    score: 72,
  };
  const movers = buildLiveMovers({
    state: {
      marketOpen: false,
      topCryptoSignals: [candidate],
      liveQuoteCache: { "BTC/USD": candidate },
    },
    normalizeSymbol,
    mergeLiveQuote: (signal) => signal,
    isCrypto,
    now: () => now,
  });

  assert.equal(movers[0].marketOpen, true, "crypto remains live around the clock");
  assert.equal(movers[0].cryptoDiscoveryScoreAvailable, true);
  assert.equal(movers[0].cryptoEntryScoreAvailable, true);
  assert.equal(movers[0].cryptoScoreTelemetry.decision.coreEvidencePass, true);
  assert.ok(Number.isFinite(movers[0].cryptoDecisionScore));
  assert.equal(movers[0].provisionalCryptoDecisionScore, null);
  assert.ok(movers[0].cryptoDecisionCoverage >= 0.8);
});

test("live movers do not replace an authoritative stock F with a sparse quote-only recalculation", () => {
  const now = new Date("2026-08-31T15:00:00.000Z");
  const movers = buildLiveMovers({
    state: {
      marketOpen: true,
      topStockSignals: [{
        symbol: "MSFT",
        price: 510,
        previousClose: 500,
        discoveryScore: 76,
        discoveryScorecard: { score: 76, coverage: 0.85 },
        entryQualityScore: 81,
        entryQualityScorecard: { score: 81, coverage: 0.9, approved: true },
        stockDecisionScore: 44,
        masterFinalScore: 83,
        decisionScoreTelemetry: {
          scores: { discovery: 76, entry: 81, decision: 83 },
          stages: { decision: { score: 83, coverage: 0.9, coreEvidencePass: true } },
        },
      }],
      liveQuoteCache: {
        MSFT: {
          price: 510,
          bid: 509.98,
          ask: 510.02,
          spreadAvailable: true,
          spreadPercent: 0.0078,
          liveQuoteUpdatedAt: now.toISOString(),
          liveQuoteSource: "alpaca_latest_stock_quote",
          priceIsLive: true,
        },
      },
    },
    normalizeSymbol,
    mergeLiveQuote: (signal) => signal,
    isCrypto,
    now: () => now,
  });

  assert.equal(movers[0].stockDecisionScore, 83);
  assert.equal(movers[0].stockDecisionScoreAvailable, true);
  assert.equal(movers[0].stockDecisionScoreSource, "engine_final_decision");
  assert.equal(movers[0].decisionScoreTelemetry.scores.decision, 83);
});

test("crypto Discovery remains visible after its execution freshness window expires", () => {
  const now = new Date("2026-08-31T15:00:00.000Z");
  const calculatedAt = new Date(now.getTime() - 20 * 60 * 1000).toISOString();
  const candidate = {
    symbol: "ETH/USD",
    price: 4500,
    previousClose: 4400,
    priceIsLive: true,
    liveQuoteUpdatedAt: now.toISOString(),
    cryptoDiscoveryScorecard: {
      score: 74,
      coverage: 0.85,
      calculatedAt,
      extension: { alreadyExtended: false },
    },
    barsFound: 30,
    windowDollarVolume: 2_000_000,
    newsCatalyst: { dataAvailable: true, riskDetected: false },
  };
  const movers = buildLiveMovers({
    state: {
      topCryptoSignals: [candidate],
      liveQuoteCache: {
        "ETH/USD": {
          ...candidate,
          bid: 4499,
          ask: 4501,
          spreadAvailable: true,
          spreadPercent: 0.044,
        },
      },
    },
    normalizeSymbol,
    mergeLiveQuote: (signal) => signal,
    isCrypto,
    now: () => now,
  });

  assert.equal(movers[0].rawCryptoScore, 74);
  assert.equal(movers[0].cryptoDiscoveryScoreAvailable, true);
  assert.equal(movers[0].cryptoDiscoveryScoreFresh, false);
  assert.ok(Number.isFinite(movers[0].provisionalCryptoDecisionScore));
});

test("raw early movers surface before five-minute scoring and remain explicitly watch-only", () => {
  const now = new Date("2026-08-31T12:05:00.000Z");
  const movers = buildLiveMovers({
    state: {
      marketOpen: false,
      marketSession: "premarket",
      liveEarlyMoverSymbols: ["WETO"],
      liveQuoteCache: {
        WETO: {
          price: 4.25,
          previousClose: 3.75,
          bid: 4.2,
          ask: 4.3,
          spreadAvailable: true,
          spreadPercent: 2.3529,
          spreadUpdatedAt: now.toISOString(),
          liveQuoteUpdatedAt: now.toISOString(),
          liveQuoteSource: "alpaca_latest_stock_quote",
          priceIsLive: true,
          quoteSession: "premarket",
          premarketSpreadAcceptable: true,
        },
      },
    },
    normalizeSymbol,
    mergeLiveQuote: (signal) => signal,
    isCrypto,
    now: () => now,
  });

  assert.equal(movers.length, 1);
  assert.equal(movers[0].symbol, "WETO");
  assert.equal(movers[0].candidateSource, "RAW_EARLY_MOVER");
  assert.equal(movers[0].qualifiedToBuy, false);
  assert.equal(movers[0].autoTradeApproved, false);
  assert.equal(movers[0].recommendedTradeAmount, 0);
  assert.equal(movers[0].stockDecisionScoreAvailable, false);
  assert.ok(movers[0].missingEvidenceReasons.includes("FIVE_MINUTE_HISTORY_PENDING"));
  assert.ok(movers[0].changePercent > 10);
});

test("live movers reject an unrecognized source even when an upstream flag says live", () => {
  const now = new Date("2026-08-31T15:00:00.000Z");
  const movers = buildLiveMovers({
    state: {
      topStockSignals: [{ symbol: "FAKE", price: 10, previousClose: 9 }],
      liveQuoteCache: {
        FAKE: {
          price: 10,
          bid: 9.99,
          ask: 10.01,
          spreadAvailable: true,
          spreadUpdatedAt: now.toISOString(),
          liveQuoteUpdatedAt: now.toISOString(),
          liveQuoteSource: "scanner_snapshot",
          priceIsLive: true,
        },
      },
    },
    normalizeSymbol,
    mergeLiveQuote: (signal) => signal,
    isCrypto,
    now: () => now,
  });

  assert.equal(movers[0].priceIsLive, false);
  assert.equal(movers[0].liveQuoteFresh, false);
  assert.equal(movers[0].entryQualityScoreAvailable, false);
});

test("live movers never borrow a trade timestamp for bid and ask freshness", () => {
  const now = new Date("2026-08-31T15:00:00.000Z");
  const movers = buildLiveMovers({
    state: {
      topStockSignals: [{ symbol: "AAPL", price: 100, previousClose: 99 }],
      liveQuoteCache: {
        AAPL: {
          price: 100,
          bid: 99.99,
          ask: 100.01,
          spreadAvailable: true,
          liveQuoteUpdatedAt: now.toISOString(),
          liveQuoteSource: "alpaca_latest_stock_quote",
          priceIsLive: true,
        },
      },
    },
    normalizeSymbol,
    mergeLiveQuote: (signal) => signal,
    isCrypto,
    now: () => now,
  });

  assert.equal(movers[0].liveQuoteFresh, true);
  assert.equal(movers[0].liveSpreadFresh, false);
  assert.equal(movers[0].spreadUpdatedAt, null);
});
