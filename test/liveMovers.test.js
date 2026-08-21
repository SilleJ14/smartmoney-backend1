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
