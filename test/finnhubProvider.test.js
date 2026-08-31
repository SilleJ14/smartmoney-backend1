import test from "node:test";
import assert from "node:assert/strict";
import { finnhubQuote } from "../providers/finnhubProvider.js";

function createState() {
  return { apiCooldowns: {}, apiFailureCounts: {} };
}

test("Finnhub REST quotes use provider time and an approved stock source", async () => {
  const providerSeconds = 1_788_200_000;
  const quote = await finnhubQuote({
    symbol: "AAPL",
    apiKey: "test",
    engineState: createState(),
    normalizeSymbol: (symbol) => String(symbol).toUpperCase(),
    fetchWithTimeout: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ c: 201.5, pc: 199, h: 202, l: 198, o: 200, t: providerSeconds }),
    }),
  });

  assert.equal(quote.liveQuoteSource, "finnhub_rest_quote");
  assert.equal(quote.priceIsLive, true);
  assert.equal(
    quote.liveQuoteUpdatedAt,
    new Date(providerSeconds * 1000).toISOString()
  );
});

test("Finnhub REST quotes without provider time are not treated as live", async () => {
  const quote = await finnhubQuote({
    symbol: "AAPL",
    apiKey: "test",
    engineState: createState(),
    normalizeSymbol: (symbol) => String(symbol).toUpperCase(),
    fetchWithTimeout: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ c: 201.5, pc: 199 }),
    }),
  });

  assert.equal(quote, null);
});
