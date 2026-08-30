import test from "node:test";
import assert from "node:assert/strict";
import { createAlpacaCryptoMarketData } from "../market-data/alpacaCryptoMarketData.js";
const normalizeSymbol = (s) => String(s).toUpperCase();
test("uses quote midpoint for crypto price", async () => {
  const service = createAlpacaCryptoMarketData({ dataRequest: async () => ({ quotes: { "BTC/USD": { bp: 99, ap: 101 } } }), normalizeSymbol, now: () => new Date("2026-01-01T00:00:00Z") });
  assert.equal((await service.getLatestQuote("BTC/USD")).price, 100);
});
test("falls back to latest trade when quote is empty", async () => {
  let calls = 0;
  const service = createAlpacaCryptoMarketData({ dataRequest: async () => ++calls === 1 ? { quotes: {} } : { trades: { "BTC/USD": { p: 105 } } }, normalizeSymbol });
  assert.equal((await service.getLatestQuote("BTC/USD")).price, 105);
});
test("batches visible crypto quote refreshes into one provider request", async () => {
  const requestedPaths = [];
  const service = createAlpacaCryptoMarketData({
    dataRequest: async (path) => {
      requestedPaths.push(path);
      return {
        quotes: {
          "BTC/USD": { bp: 99, ap: 101, t: "2026-08-30T12:00:00.000Z" },
          "ETH/USD": { bp: 199, ap: 201, t: "2026-08-30T12:00:01.000Z" },
        },
      };
    },
    normalizeSymbol,
    now: () => new Date("2026-08-30T12:00:02.000Z"),
  });
  const quotes = await service.getLatestQuotes(["BTC/USD", "ETH/USD"]);
  assert.equal(requestedPaths.length, 1);
  assert.match(requestedPaths[0], /BTC%2FUSD%2CETH%2FUSD/);
  assert.deepEqual(quotes.map((quote) => quote.price), [100, 200]);
  assert.ok(quotes.every((quote) => quote.priceIsLive === true));
});
test("normalizes and filters crypto bars", async () => {
  const service = createAlpacaCryptoMarketData({ dataRequest: async () => ({ bars: { "BTC/USD": [{ c: 100, o: 90, h: 110, l: 80, v: 4 }, { c: 0 }] } }), normalizeSymbol });
  assert.deepEqual(await service.getRecentBars("BTC/USD"), [{ t: undefined, o: 90, h: 110, l: 80, c: 100, v: 4, source: "alpaca_crypto_bars" }]);
});

test("requests a bounded newest-first lookback instead of Alpaca's current-day default", async () => {
  let requestedPath = "";
  const service = createAlpacaCryptoMarketData({
    dataRequest: async (path) => {
      requestedPath = path;
      return { bars: { "BTC/USD": [] } };
    },
    normalizeSymbol,
    now: () => new Date("2026-08-26T22:00:00.000Z"),
  });
  await service.getRecentBars("BTC/USD", "1Day", 30);
  const url = new URL(`https://data.alpaca.markets${requestedPath}`);
  assert.equal(url.searchParams.get("symbols"), "BTC/USD");
  assert.equal(url.searchParams.get("timeframe"), "1Day");
  assert.equal(url.searchParams.get("limit"), "30");
  assert.equal(url.searchParams.get("sort"), "desc");
  assert.equal(url.searchParams.get("end"), "2026-08-26T22:00:00.000Z");
  assert.equal(url.searchParams.get("start"), "2026-07-21T22:00:00.000Z");
});
