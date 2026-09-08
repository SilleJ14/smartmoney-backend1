import test from "node:test";
import assert from "node:assert/strict";
import { createStockExecutionQuoteRefresher } from "../market-data/stockExecutionQuoteRefresh.js";

test("stock execution quotes refresh in one provider batch and preserve measured session change", async () => {
  const providerTimestamp = "2026-09-01T14:30:04.000Z";
  const requests = [];
  const refresh = createStockExecutionQuoteRefresher({
    normalizeSymbol: (symbol) => String(symbol || "").toUpperCase(),
    getLatestQuotes: async (symbols) => {
      requests.push(symbols);
      return symbols.map((symbol) => ({
        symbol,
        price: 105,
        bid: 104.99,
        ask: 105.01,
        spreadAvailable: true,
        spreadUpdatedAt: providerTimestamp,
        liveQuoteUpdatedAt: providerTimestamp,
        liveQuoteSource: "alpaca_latest_stock_quote",
        priceIsLive: true,
        percentChange: null,
        percentChangeAvailable: false,
      }));
    },
    updateQuoteCache: (_symbol, quote) => ({
      ...quote,
      current: quote.price,
      spread: 0.02,
      spreadPercent: 0.019,
      percentChange: 5,
      percentChangeAvailable: true,
      percentChangeReferencePrice: 100,
      percentChangeReferenceType: "previous_close",
    }),
  });

  const refreshed = await refresh([
    {
      symbol: "aapl",
      price: 104,
      percentChange: 4,
      percentChangeAvailable: true,
      percentChangeReferencePrice: 100,
    },
    { symbol: "MSFT", price: 104 },
  ]);

  assert.deepEqual(requests, [["AAPL", "MSFT"]]);
  assert.equal(refreshed[0].price, 105);
  assert.equal(refreshed[0].bid, 104.99);
  assert.equal(refreshed[0].spreadUpdatedAt, providerTimestamp);
  assert.equal(refreshed[0].percentChange, 5);
  assert.equal(refreshed[0].percentChangeAvailable, true);
});

test("failed stock execution refresh preserves original signal identities", async () => {
  const original = [{ symbol: "AAPL", percentChange: 2 }];
  let reported = null;
  const refresh = createStockExecutionQuoteRefresher({
    normalizeSymbol: String,
    getLatestQuotes: async () => { throw new Error("unavailable"); },
    updateQuoteCache: () => null,
    onError: (error) => { reported = error; },
  });

  assert.equal(await refresh(original), original);
  assert.equal(reported.message, "unavailable");
});
