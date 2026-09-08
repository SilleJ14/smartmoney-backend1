import test from "node:test";
import assert from "node:assert/strict";
import { createTradierMarketData, normalizeTradierQuote } from "../providers/tradierMarketData.js";
import { evaluateLiveQuoteProviderReadiness } from "../live/liveQuoteCache.js";
const now = Date.now();
const row = { symbol: "AAPL", type: "stock", last: 100, prevclose: 99, bid: 99.99, ask: 100.01,
  bid_date: now - 1000, ask_date: now - 500, trade_date: now - 2000 };
test("Tradier uses the older bid/ask timestamp and calculates measured change", () => {
  const quote = normalizeTradierQuote(row, { now });
  assert.equal(quote.spreadUpdatedAt, new Date(now - 1000).toISOString());
  assert.equal(quote.liveQuoteUpdatedAt, quote.spreadUpdatedAt);
  assert.equal(quote.priceIsLive, true);
  assert.equal(quote.percentChangeAvailable, true);
  assert.equal(evaluateLiveQuoteProviderReadiness(quote.source).connected, true);
  assert.equal(evaluateLiveQuoteProviderReadiness(quote.source, { isCrypto: true }).connected, false);
});
test("fresh trades cannot freshen old bid/ask and sandbox is never executable", () => {
  const quote = normalizeTradierQuote({ ...row, bid_date: now - 60000, trade_date: now }, { now });
  assert.equal(quote.liveQuoteUpdatedAt, new Date(now).toISOString());
  assert.equal(quote.spreadUpdatedAt, new Date(now - 60000).toISOString());
  assert.equal(normalizeTradierQuote(row, { now, sandbox: true }).priceIsLive, false);
  assert.equal(normalizeTradierQuote({ ...row, symbol: "BTC/USD" }, { now }), null);
  assert.equal(normalizeTradierQuote({ ...row, bid_date: now + 60000 }, { now }).spreadAvailable, false);
  assert.equal(normalizeTradierQuote({ ...row, bid: 101 }, { now }).spreadAvailable, false);
});
test("Tradier batches, deduplicates in-flight requests and sends only server credentials", async () => {
  let calls = 0;
  const api = createTradierMarketData({ apiKey: "test-token", now: () => now, fetchImpl: async (url, options) => {
    calls++;
    assert.ok(url.startsWith("https://api.tradier.com/v1/markets/quotes?"));
    assert.equal(options.headers.Authorization, "Bearer test-token");
    assert.ok(!url.includes("test-token"));
    return new Response(JSON.stringify({ quotes: { quote: row } }), { headers: { "Content-Type": "application/json" } });
  } });
  const [a, b] = await Promise.all([api.getLatestQuotes(["AAPL", "BTC/USD"]), api.getLatestQuotes(["AAPL"])]);
  assert.equal(calls, 1);
  assert.equal(a[0].symbol, "AAPL");
  assert.deepEqual(a, b);
  assert.ok(!JSON.stringify(api.getStatus()).includes("test-token"));
});
test("Tradier rate limiting backs off without preventing fallback callers", async () => {
  let calls = 0;
  const api = createTradierMarketData({ apiKey: "test", now: () => now, fetchImpl: async () => {
    calls++;
    return new Response("", { status: 429 });
  } });
  assert.deepEqual(await api.getLatestQuotes(["AAPL"]), []);
  assert.deepEqual(await api.getLatestQuotes(["AAPL"]), []);
  assert.equal(calls, 1);
  assert.equal(api.getStatus().lastError, "TRADIER_REQUEST_FAILED");
});
