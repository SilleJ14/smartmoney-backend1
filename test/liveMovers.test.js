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
