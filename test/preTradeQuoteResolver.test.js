import test from "node:test";
import assert from "node:assert/strict";
import { resolvePreTradeQuote } from "../live/preTradeQuoteResolver.js";

test("keeps a ready cached quote without spending fallback bandwidth", async () => {
  let fallbackCalls = 0;
  const cachedQuote = { source: "finnhub_ws_trade", price: 100 };
  const result = await resolvePreTradeQuote({
    cachedQuote,
    isQuoteReady: () => true,
    fetchFallback: async () => {
      fallbackCalls += 1;
      return { source: "alpaca_latest_stock_quote", price: 101 };
    },
  });
  assert.equal(result.quote, cachedQuote);
  assert.equal(result.usedFallback, false);
  assert.equal(result.fallbackAttempted, false);
  assert.equal(fallbackCalls, 0);
});

test("replaces an unavailable provider quote with Alpaca at order time", async () => {
  let stored = null;
  const fallbackQuote = {
    source: "alpaca_latest_stock_quote",
    price: 101,
    bid: 100.9,
    ask: 101.1,
  };
  const result = await resolvePreTradeQuote({
    cachedQuote: { source: "polygon_ws_quote", price: 100 },
    isQuoteReady: () => false,
    fetchFallback: async () => fallbackQuote,
    storeFallback: (quote) => {
      stored = { ...quote, stored: true };
      return stored;
    },
  });
  assert.equal(result.usedFallback, true);
  assert.equal(result.fallbackAttempted, true);
  assert.equal(result.quote, stored);
  assert.equal(result.quote.source, "alpaca_latest_stock_quote");
});

test("fails closed on fallback failure while retaining diagnostic evidence", async () => {
  const cachedQuote = { source: "polygon_ws_quote", price: 100 };
  const result = await resolvePreTradeQuote({
    cachedQuote,
    isQuoteReady: () => false,
    fetchFallback: async () => {
      throw new Error("Alpaca unavailable");
    },
  });
  assert.equal(result.quote, cachedQuote);
  assert.equal(result.usedFallback, false);
  assert.equal(result.fallbackAttempted, true);
  assert.equal(result.fallbackError, "Alpaca unavailable");
});
