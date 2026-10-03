import test from "node:test";
import assert from "node:assert/strict";
import {
  POLYGON_DELAYED_SNAPSHOT_SOURCE,
  POLYGON_STOCK_SNAPSHOT_SOURCE,
  createPolygonStockQuotes,
  normalizePolygonSnapshotQuote,
  polygonTimestampMs,
} from "../providers/polygonProvider.js";
import { getStockExecutionEvidenceFreshness } from "../market-data/stockQuoteEvidence.js";
import { isLiveQuoteSource } from "../live/liveQuoteCache.js";

const now = Date.parse("2026-10-02T14:00:00.000Z");
const ns = (ms) => ms * 1e6;
const iso = (ms) => new Date(ms).toISOString();
const ticker = (overrides = {}) => ({
  ticker: "AAPL",
  todaysChangePerc: 1.2,
  day: { o: 99, h: 101, l: 98.5, c: 100.01, v: 1234567 },
  prevDay: { c: 98 },
  lastQuote: { p: 100, P: 100.02, s: 3, S: 4, t: ns(now - 1000) },
  lastTrade: { p: 100.01, s: 50, t: ns(now - 2000) },
  ...overrides,
});
const json = (body, init = {}) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" }, ...init });

test("Polygon nanosecond clocks convert to milliseconds and future or invalid clocks are rejected", () => {
  assert.equal(polygonTimestampMs(1759413600123456789, now), 1759413600123);
  assert.equal(polygonTimestampMs("1759413600123456789", now), 1759413600123);
  assert.equal(polygonTimestampMs(ns(now + 60000), now), null, "future clock");
  assert.equal(polygonTimestampMs(ns(now + 4000), now), now + 4000, "5 s skew tolerated");
  for (const bad of [null, undefined, "", 0, -5, "abc", true, Number.NaN, 12]) assert.equal(polygonTimestampMs(bad, now), null);
});

test("a fresh Polygon snapshot is a real-time consolidated quote with its own clocks", () => {
  const quote = normalizePolygonSnapshotQuote(ticker(), { now });
  assert.equal(quote.symbol, "AAPL");
  assert.ok(Math.abs(quote.price - 100.01) < 1e-9, "mid of the pair");
  assert.equal(quote.current, quote.price);
  assert.equal(quote.bid, 100);
  assert.equal(quote.ask, 100.02);
  // Mid of the newer pair, stamped with the pair's clock, never the trade's.
  assert.equal(quote.liveQuoteUpdatedAt, iso(now - 1000));
  assert.equal(quote.spreadUpdatedAt, iso(now - 1000));
  assert.equal(quote.bidAskUpdatedAt, iso(now - 1000));
  assert.equal(quote.tradeUpdatedAt, iso(now - 2000));
  assert.equal(quote.lastTradePrice, 100.01);
  assert.equal(quote.previousClose, 98);
  assert.equal(quote.open, 99);
  assert.equal(quote.high, 101);
  assert.equal(quote.low, 98.5);
  assert.equal(quote.volume, 1234567);
  assert.ok(Math.abs(quote.percentChange - ((100.01 - 98) / 98) * 100) < 1e-6);
  assert.equal(quote.spreadAvailable, true);
  assert.ok(quote.spreadPercent > 0 && quote.spreadPercent < 0.03);
  assert.equal(quote.source, POLYGON_STOCK_SNAPSHOT_SOURCE);
  assert.equal(quote.liveQuoteSource, POLYGON_STOCK_SNAPSHOT_SOURCE);
  assert.equal(quote.priceIsLive, true);
  assert.equal(quote.delayed, false);
  assert.equal(quote.timing, "REALTIME");
  assert.equal(quote.provider, "MASSIVE");
  assert.equal(quote.provenance.provider, "MASSIVE");
  assert.equal(quote.provenance.feed, "CONSOLIDATED");
  assert.equal(quote.provenance.isConsolidated, true);
  assert.equal(quote.bidSizeRaw, 3);
  assert.equal(quote.bidSizeShares, null, "snapshot size unit is not assumed");
  assert.equal(isLiveQuoteSource(quote.source, "stock"), true);
  assert.equal(isLiveQuoteSource(quote.source, "crypto"), false);
  const evidence = getStockExecutionEvidenceFreshness(quote, { now });
  assert.equal(evidence.quoteFresh, true);
  assert.equal(evidence.spreadFresh, true);
});

test("a newer trade owns the price and never freshens the older pair", () => {
  const quote = normalizePolygonSnapshotQuote(ticker({
    lastQuote: { p: 100, P: 100.02, t: ns(now - 30000) },
    lastTrade: { p: 100.5, t: ns(now - 500) },
  }), { now });
  assert.equal(quote.price, 100.5);
  assert.equal(quote.liveQuoteUpdatedAt, iso(now - 500));
  assert.equal(quote.spreadUpdatedAt, iso(now - 30000));
  assert.equal(quote.priceIsLive, true);
  const evidence = getStockExecutionEvidenceFreshness(quote, { now });
  assert.equal(evidence.quoteFresh, true);
  assert.equal(evidence.spreadFresh, false, "a 30 s old pair stays stale");
});

test("one-sided, crossed or unstamped books never become a spread", () => {
  const oneSided = normalizePolygonSnapshotQuote(ticker({ lastQuote: { p: 100, t: ns(now - 1000) } }), { now });
  assert.equal(oneSided.spreadAvailable, false);
  assert.equal(oneSided.bid, 0);
  assert.equal(oneSided.ask, 0);
  assert.equal(oneSided.spreadUpdatedAt, null);
  assert.equal(oneSided.bidUpdatedAt, iso(now - 1000));
  assert.equal(oneSided.askUpdatedAt, null);
  assert.equal(oneSided.price, 100.01, "falls back to the trade");
  assert.equal(oneSided.liveQuoteUpdatedAt, iso(now - 2000));
  assert.equal(getStockExecutionEvidenceFreshness(oneSided, { now }).spreadFresh, false);
  const crossed = normalizePolygonSnapshotQuote(ticker({ lastQuote: { p: 100.05, P: 100, t: ns(now - 1000) } }), { now });
  assert.equal(crossed.spreadAvailable, false);
  const unstamped = normalizePolygonSnapshotQuote(ticker({ lastQuote: { p: 100, P: 100.02 } }), { now });
  assert.equal(unstamped.spreadAvailable, false);
  assert.equal(unstamped.liveQuoteUpdatedAt, iso(now - 2000));
  assert.equal(normalizePolygonSnapshotQuote(ticker({ lastQuote: { p: 100 }, lastTrade: {} }), { now }), null,
    "no measured price and clock => no quote");
});

test("legacy bp/ap fields are accepted", () => {
  const quote = normalizePolygonSnapshotQuote(ticker({ lastQuote: { bp: 50, ap: 50.02, t: ns(now - 1000) } }), { now });
  assert.equal(quote.bid, 50);
  assert.equal(quote.ask, 50.02);
  assert.equal(quote.spreadAvailable, true);
});

test("a 15-minute delayed snapshot is labelled delayed and can never be live or executable", () => {
  const old = now - 15 * 60000;
  const quote = normalizePolygonSnapshotQuote(ticker({
    lastQuote: { p: 100, P: 100.02, t: ns(old) }, lastTrade: { p: 100.01, t: ns(old - 1000) },
  }), { now });
  assert.equal(quote.delayed, true);
  assert.equal(quote.timing, "DELAYED");
  assert.equal(quote.priceIsLive, false);
  assert.equal(quote.spreadAvailable, false);
  assert.equal(quote.source, POLYGON_DELAYED_SNAPSHOT_SOURCE);
  assert.equal(isLiveQuoteSource(quote.source, "stock"), false);
  assert.equal(quote.liveQuoteUpdatedAt, iso(old), "provider clock kept, not receipt time");
  const evidence = getStockExecutionEvidenceFreshness(quote, { now });
  assert.equal(evidence.quoteFresh, false);
  assert.equal(evidence.spreadFresh, false);
  // Even if a later consumer re-stamps priceIsLive, the source is not live.
  assert.equal(getStockExecutionEvidenceFreshness({ ...quote, priceIsLive: true, liveQuoteUpdatedAt: iso(now) }, { now }).quoteFresh, false);
});

test("a response that says DELAYED is delayed even with recent-looking clocks", () => {
  const quote = normalizePolygonSnapshotQuote(ticker(), { now, delayed: true });
  assert.equal(quote.delayed, true);
  assert.equal(quote.priceIsLive, false);
  assert.equal(quote.source, POLYGON_DELAYED_SNAPSHOT_SOURCE);
});

test("a recent but not live clock is real-time timing yet not an execution quote", () => {
  const quote = normalizePolygonSnapshotQuote(ticker({
    lastQuote: { p: 100, P: 100.02, t: ns(now - 30000) }, lastTrade: { p: 100.01, t: ns(now - 31000) },
  }), { now });
  assert.equal(quote.timing, "REALTIME");
  assert.equal(quote.priceIsLive, false);
  assert.equal(getStockExecutionEvidenceFreshness(quote, { now }).quoteFresh, false);
});

test("future clocks are rejected instead of becoming fresh evidence", () => {
  const futureQuote = normalizePolygonSnapshotQuote(ticker({ lastQuote: { p: 100, P: 100.02, t: ns(now + 60000) } }), { now });
  assert.equal(futureQuote.spreadAvailable, false);
  assert.equal(futureQuote.liveQuoteUpdatedAt, iso(now - 2000));
  assert.equal(normalizePolygonSnapshotQuote(ticker({
    lastQuote: { p: 100, P: 100.02, t: ns(now + 60000) }, lastTrade: { p: 100, t: ns(now + 60000) },
  }), { now }), null);
  assert.equal(normalizePolygonSnapshotQuote(ticker({ ticker: "BTC/USD" }), { now }), null);
  assert.equal(normalizePolygonSnapshotQuote(null, { now }), null);
});

test("the batch fetcher sends the key only in a header and returns only requested symbols", async () => {
  const calls = [];
  const api = createPolygonStockQuotes({ apiKey: "poly-secret", enabled: true, now: () => now, fetchImpl: async (url, options) => {
    calls.push(url);
    assert.equal(options.headers.Authorization, "Bearer poly-secret");
    assert.ok(!url.includes("poly-secret"));
    return json({ status: "OK", tickers: [ticker(), ticker({ ticker: "MSFT" }), ticker({ ticker: "EXTRA" })] });
  } });
  const [a, b] = await Promise.all([api.getLatestQuotes(["msft", "AAPL", "BTC/USD"]), api.getLatestQuotes(["AAPL", "MSFT"])]);
  assert.equal(calls.length, 1, "in-flight batches are shared");
  const url = new URL(calls[0]);
  assert.equal(url.origin + url.pathname, "https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers");
  assert.equal(url.searchParams.get("tickers"), "AAPL,MSFT");
  assert.deepEqual(a.map((q) => q.symbol).sort(), ["AAPL", "MSFT"]);
  assert.deepEqual(a, b);
  const status = api.getStatus();
  assert.equal(status.authentication.state, "PASS");
  assert.equal(status.entitlement.marketData, "REALTIME_CONSOLIDATED");
  assert.equal(status.realtimeCount, 2);
  assert.ok(!JSON.stringify(status).includes("poly-secret"));
});

test("a DELAYED plan is reported as delayed entitlement", async () => {
  const api = createPolygonStockQuotes({ apiKey: "k", enabled: true, now: () => now,
    fetchImpl: async () => json({ status: "DELAYED", tickers: [ticker()] }) });
  const [quote] = await api.getLatestQuotes(["AAPL"]);
  assert.equal(quote.delayed, true);
  assert.equal(api.getStatus().entitlement.marketData, "DELAYED");
  assert.equal(api.getStatus().delayedCount, 1);
});

test("authentication failures and rate limits back off without retrying every batch", async () => {
  for (const [code, reason] of [[401, "POLYGON_AUTH_FAILED"], [403, "POLYGON_NOT_AUTHORIZED"]]) {
    let calls = 0;
    const api = createPolygonStockQuotes({ apiKey: "k", enabled: true, now: () => now,
      fetchImpl: async () => { calls++; return json({ status: "ERROR" }, { status: code }); } });
    assert.deepEqual(await api.getLatestQuotes(["AAPL"]), []);
    assert.deepEqual(await api.getLatestQuotes(["AAPL"]), []);
    assert.equal(calls, 1);
    assert.equal(api.getStatus().authentication.state, "FAIL");
    assert.equal(api.getStatus().lastError, reason);
    assert.equal(api.getStatus().lastSkipReason, "PROVIDER_BACKOFF");
  }
  let calls = 0, throttled = 0;
  const limited = createPolygonStockQuotes({ apiKey: "k", enabled: true, now: () => now, onRateLimited: () => throttled++,
    fetchImpl: async () => { calls++; return new Response("", { status: 429, headers: { "retry-after": "30" } }); } });
  assert.deepEqual(await limited.getLatestQuotes(["AAPL"]), []);
  assert.deepEqual(await limited.getLatestQuotes(["AAPL"]), []);
  assert.equal(calls, 1);
  assert.equal(throttled, 1, "the account-wide Polygon cooldown is set");
  assert.equal(limited.getStatus().lastError, "POLYGON_RATE_LIMITED");
  assert.equal(limited.getStatus().blockedUntil, now + 30000);
});

test("a shared Polygon cooldown, a disabled provider or a missing key never fetches", async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; return json({ tickers: [ticker()] }); };
  const cooled = createPolygonStockQuotes({ apiKey: "k", enabled: true, now: () => now, fetchImpl, isSharedCooldownActive: () => true });
  assert.deepEqual(await cooled.getLatestQuotes(["AAPL"]), []);
  assert.equal(cooled.getStatus().lastSkipReason, "SHARED_POLYGON_COOLDOWN");
  assert.deepEqual(await createPolygonStockQuotes({ apiKey: "k", enabled: false, fetchImpl }).getLatestQuotes(["AAPL"]), []);
  const missing = createPolygonStockQuotes({ apiKey: "", enabled: true, fetchImpl });
  assert.deepEqual(await missing.getLatestQuotes(["AAPL"]), []);
  assert.equal(missing.getStatus().configured, false);
  assert.equal(calls, 0);
});

test("the local request budget caps Polygon fallback traffic", async () => {
  let calls = 0;
  const api = createPolygonStockQuotes({ apiKey: "k", enabled: true, now: () => now, maxRequestsPerMinute: 2,
    fetchImpl: async () => { calls++; return json({ tickers: [ticker()] }); } });
  for (const symbol of ["AAPL", "MSFT", "NVDA"]) await api.getLatestQuotes([symbol]);
  assert.equal(calls, 2);
  assert.equal(api.getStatus().lastSkipReason, "LOCAL_RATE_BUDGET");
});

test("timeouts, malformed and oversized responses fail closed with a bounded wait", async () => {
  const stalled = createPolygonStockQuotes({ apiKey: "k", enabled: true,
    fetchImpl: (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })))) });
  const started = Date.now();
  assert.deepEqual(await stalled.getLatestQuotes(["AAPL"], { timeoutMs: 30 }), []);
  assert.ok(Date.now() - started < 1000);
  assert.equal(stalled.getStatus().lastError, "POLYGON_TIMEOUT");
  assert.ok(stalled.getStatus().blockedUntil > Date.now(), "a failure backs off");
  const stalledBody = createPolygonStockQuotes({ apiKey: "k", enabled: true,
    fetchImpl: async () => new Response(new ReadableStream({ start() {} })) });
  assert.deepEqual(await stalledBody.getLatestQuotes(["AAPL"], { timeoutMs: 30 }), []);
  const malformed = createPolygonStockQuotes({ apiKey: "k", enabled: true, fetchImpl: async () => new Response("{invalid") });
  assert.deepEqual(await malformed.getLatestQuotes(["AAPL"]), []);
  assert.equal(malformed.getStatus().lastError, "POLYGON_MALFORMED_RESPONSE");
  const wrongShape = createPolygonStockQuotes({ apiKey: "k", enabled: true, fetchImpl: async () => json({ tickers: "AAPL" }) });
  assert.deepEqual(await wrongShape.getLatestQuotes(["AAPL"]), []);
  const oversized = createPolygonStockQuotes({ apiKey: "k", enabled: true, fetchImpl: async () => new Response(new ReadableStream({
    start(controller) { for (let i = 0; i < 3; i++) controller.enqueue(new Uint8Array(512 * 1024)); controller.close(); },
  })) });
  assert.deepEqual(await oversized.getLatestQuotes(["AAPL"]), []);
  const server = createPolygonStockQuotes({ apiKey: "k", enabled: true, fetchImpl: async () => json({}, { status: 503 }) });
  assert.deepEqual(await server.getLatestQuotes(["AAPL"]), []);
  assert.equal(server.getStatus().lastError, "POLYGON_HTTP_503");
});

test("a caller abort ends the request without blaming the provider", async () => {
  const controller = new AbortController();
  const api = createPolygonStockQuotes({ apiKey: "k", enabled: true,
    fetchImpl: (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })))) });
  const pending = api.getLatestQuotes(["AAPL"], { signal: controller.signal, timeoutMs: 5000 });
  controller.abort();
  assert.deepEqual(await pending, []);
  assert.equal(api.getStatus().lastError, "POLYGON_CALLER_ABORTED");
  assert.equal(api.getStatus().blockedUntil, 0);
});
