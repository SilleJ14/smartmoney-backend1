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
test("normalizes and filters crypto bars", async () => {
  const service = createAlpacaCryptoMarketData({ dataRequest: async () => ({ bars: { "BTC/USD": [{ c: 100, o: 90, h: 110, l: 80, v: 4 }, { c: 0 }] } }), normalizeSymbol });
  assert.deepEqual(await service.getRecentBars("BTC/USD"), [{ t: undefined, o: 90, h: 110, l: 80, c: 100, v: 4, source: "alpaca_crypto_bars" }]);
});
