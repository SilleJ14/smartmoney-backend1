import test from "node:test";
import assert from "node:assert/strict";
import { createCryptoExecutionQuoteRefresher } from "../market-data/cryptoExecutionQuoteRefresh.js";

test("crypto execution evidence is batch-refreshed with provider-timestamped Alpaca bid and ask", async () => {
  const providerTimestamp = "2026-08-31T14:00:04.000Z";
  const requestedBatches = [];
  const cacheUpdates = [];
  const refresh = createCryptoExecutionQuoteRefresher({
    normalizeSymbol: (symbol) => String(symbol || "").toUpperCase(),
    getLatestQuotes: async (symbols) => {
      requestedBatches.push(symbols);
      return symbols.map((symbol, index) => ({
        symbol,
        price: 106 + index,
        current: 106 + index,
        bid: 105.99 + index,
        ask: 106.01 + index,
        spreadAvailable: true,
        spreadUpdatedAt: providerTimestamp,
        bidAskUpdatedAt: providerTimestamp,
        quoteFetchedAt: providerTimestamp,
        liveQuoteUpdatedAt: providerTimestamp,
        source: "alpaca_crypto_latest",
        liveQuoteSource: "alpaca_crypto_latest",
        priceIsLive: true,
        percentChange: null,
        percentChangeAvailable: false,
      }));
    },
    updateQuoteCache: (symbol, quote) => {
      cacheUpdates.push({ symbol, quote });
      return {
        ...quote,
        spread: 0.02,
        spreadPercent: 0.0189,
        percentChange: symbol === "BTC/USD" ? 6 : 7,
        changePercent: symbol === "BTC/USD" ? 6 : 7,
        percentChangeAvailable: true,
        changePercentAvailable: true,
        percentChangeReferencePrice: 100,
        changeReferencePrice: 100,
        percentChangeReferenceType: "intraday_window_open",
      };
    },
  });

  const refreshed = await refresh([
    {
      symbol: "BTC/USD",
      current: 105,
      percentChange: 5,
      percentChangeAvailable: true,
      percentChangeReferencePrice: 100,
    },
    { symbol: "ETH/USD", current: 106 },
  ]);

  assert.equal(requestedBatches.length, 1);
  assert.deepEqual(requestedBatches[0], ["BTC/USD", "ETH/USD"]);
  assert.equal(cacheUpdates.length, 2);
  assert.equal(refreshed[0].current, 106);
  assert.equal(refreshed[0].bid, 105.99);
  assert.equal(refreshed[0].ask, 106.01);
  assert.equal(refreshed[0].spreadUpdatedAt, providerTimestamp);
  assert.equal(refreshed[0].liveQuote.updatedAt, providerTimestamp);
  assert.equal(refreshed[0].percentChange, 6);
  assert.equal(refreshed[0].percentChangeAvailable, true);
});

test("failed execution quote refresh leaves scanner signals intact", async () => {
  const original = [{ symbol: "BTC/USD", percentChange: 5 }];
  let reportedError = null;
  const refresh = createCryptoExecutionQuoteRefresher({
    normalizeSymbol: (symbol) => symbol,
    getLatestQuotes: async () => {
      throw new Error("provider unavailable");
    },
    updateQuoteCache: () => null,
    onError: (error) => { reportedError = error; },
  });

  assert.equal(await refresh(original), original);
  assert.equal(reportedError.message, "provider unavailable");
});
