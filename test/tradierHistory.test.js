import test from "node:test";
import assert from "node:assert/strict";
import {
  createTradierMarketData,
  easternSessionDayStartMs,
  normalizeTradierDailyBars,
  normalizeTradierTimesales,
  tradierHistoryPlan,
} from "../providers/tradierMarketData.js";
import { stockHistoryRequest, validCompletedStockBars } from "../market-data/stockHistory.js";

const json = (body, init = {}) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" }, ...init });
const day = (date, close = 10) => ({ date, open: close - 0.1, high: close + 0.5, low: close - 0.5, close, volume: 1000 });
const sale = (ms, close = 10, volume = 100) => ({ time: "ignored", timestamp: ms / 1000, price: close, open: close - 0.05,
  high: close + 0.1, low: close - 0.1, close, volume, vwap: close });

test("a Tradier trading day is stamped at 00:00 New York time in both EST and EDT", () => {
  assert.equal(easternSessionDayStartMs("2026-01-09"), Date.UTC(2026, 0, 9, 5));
  assert.equal(easternSessionDayStartMs("2026-07-10"), Date.UTC(2026, 6, 10, 4));
  // Same convention as a Polygon daily aggregate (2023-01-09 => 1673240400000).
  assert.equal(easternSessionDayStartMs("2023-01-09"), 1673240400000);
  for (const bad of ["2026-02-30", "2026-13-01", "20260109", "", null, "2026-1-9"]) {
    assert.equal(easternSessionDayStartMs(bad), null, String(bad));
  }
});

test("a daily bar is complete only after its session day ends", () => {
  // Friday 2026-10-02 11:00 New York.
  const now = Date.parse("2026-10-02T15:00:00.000Z");
  const bars = normalizeTradierDailyBars({ history: { day: [day("2026-09-30"), day("2026-10-01"), day("2026-10-02")] } });
  assert.deepEqual(bars.map((bar) => bar.t), ["2026-09-30", "2026-10-01", "2026-10-02"].map(easternSessionDayStartMs));
  const completed = validCompletedStockBars(bars, stockHistoryRequest("1Day", 25), now);
  assert.deepEqual(completed.map((bar) => new Date(bar.t).toISOString()), ["2026-09-30T04:00:00.000Z", "2026-10-01T04:00:00.000Z"]);
  // A single row arrives as an object, and an empty history as null.
  assert.equal(normalizeTradierDailyBars({ history: { day: day("2026-10-01") } }).length, 1);
  assert.deepEqual(normalizeTradierDailyBars({ history: null }), []);
  assert.deepEqual(normalizeTradierDailyBars({ history: { day: [{ ...day("2026-10-01"), date: "bad" }] } }), []);
});

test("timesales use the epoch timestamp as the bar start and drop the forming bar", () => {
  const five = 5 * 60000;
  const now = Date.parse("2026-10-02T14:12:00.000Z");
  const start = Date.parse("2026-10-02T13:50:00.000Z");
  const rows = [0, 1, 2, 3, 4].map((i) => sale(start + i * five, 10 + i));
  const bars = normalizeTradierTimesales({ series: { data: rows } }, { baseMinutes: 5, minutes: 5 });
  assert.equal(bars.length, 5);
  assert.equal(bars[0].t, start);
  assert.equal(bars[0].c, 10);
  const completed = validCompletedStockBars(bars, stockHistoryRequest("5Min", 30), now);
  // 14:10 bar is still forming at 14:12.
  assert.deepEqual(completed.map((bar) => new Date(bar.t).toISOString().slice(11, 16)), ["13:50", "13:55", "14:00", "14:05"]);
  assert.deepEqual(normalizeTradierTimesales({ series: null }, { baseMinutes: 5, minutes: 5 }), []);
  assert.equal(normalizeTradierTimesales({ series: { data: sale(start) } }, { baseMinutes: 5, minutes: 5 }).length, 1);
});

test("an interval Tradier lacks is aggregated from an exact divisor without splitting base bars", () => {
  const five = 5 * 60000;
  const start = Date.parse("2026-10-02T14:00:00.000Z");
  const rows = [
    sale(start, 10, 100), sale(start + five, 11, 200),
    sale(start + 2 * five, 12, 300), sale(start + 3 * five, 13, 400),
    sale(start + 4 * five + 60000, 99, 1), // misaligned: ignored
    sale(start + five, 50, 9999), // duplicate start: first kept
  ];
  const bars = normalizeTradierTimesales({ series: { data: rows } }, { baseMinutes: 5, minutes: 10 });
  assert.equal(bars.length, 2);
  assert.deepEqual(bars[0], { t: start, o: 9.95, h: 11.1, l: 9.9, c: 11, v: 300 });
  assert.deepEqual(bars[1], { t: start + 2 * five, o: 11.95, h: 13.1, l: 11.9, c: 13, v: 700 });
  // One unusable base bar poisons only its own composite bar.
  const poisoned = normalizeTradierTimesales({ series: { data: [
    sale(start, 10), { ...sale(start + five, 11), close: "NaN" }, sale(start + 2 * five, 12), sale(start + 3 * five, 13),
  ] } }, { baseMinutes: 5, minutes: 10 });
  assert.deepEqual(poisoned.map((bar) => bar.t), [start + 2 * five]);
  // Buckets that could start before the requested window are dropped.
  assert.deepEqual(normalizeTradierTimesales({ series: { data: rows.slice(0, 4) } },
    { baseMinutes: 5, minutes: 10, windowStartMs: start + five }).map((bar) => bar.t), [start + 2 * five]);
});

test("each requested interval maps to a Tradier interval that divides it", () => {
  const plan = (timeframe) => tradierHistoryPlan(stockHistoryRequest(timeframe, 30));
  assert.deepEqual(plan("1Day"), { endpoint: "history", interval: "daily", baseMinutes: null, minutes: null });
  assert.equal(plan("1Min").interval, "1min");
  assert.equal(plan("5Min").interval, "5min");
  assert.equal(plan("15Min").interval, "15min");
  assert.equal(plan("10Min").interval, "5min");
  assert.equal(plan("30Min").interval, "15min");
  assert.equal(plan("60Min").interval, "15min");
  assert.equal(plan("7Min").interval, "1min");
  assert.equal(tradierHistoryPlan({ multiplier: 2, timespan: "hour" }), null);
  assert.equal(tradierHistoryPlan({ multiplier: 0, timespan: "minute" }), null);
});

test("history requests hit the right endpoint with server credentials and ET windows", async () => {
  const now = Date.parse("2026-10-02T15:07:00.000Z");
  const calls = [];
  const api = createTradierMarketData({ apiKey: "tradier-secret", now: () => now, fetchImpl: async (url, options) => {
    calls.push(new URL(url));
    assert.equal(options.headers.Authorization, "Bearer tradier-secret");
    assert.ok(!url.includes("tradier-secret"));
    if (url.includes("/markets/history")) return json({ history: { day: [day("2026-09-30"), day("2026-10-01"), day("2026-10-02")] } });
    const base = Date.parse("2026-10-02T14:00:00.000Z");
    return json({ series: { data: [0, 1, 2, 3, 4, 5].map((i) => sale(base + i * 300000, 10 + i)) } });
  } });
  const daily = await api.getHistory("aapl", "1Day", stockHistoryRequest("1Day", 25));
  assert.equal(daily.length, 3);
  const [history] = calls;
  assert.equal(history.origin + history.pathname, "https://api.tradier.com/v1/markets/history");
  assert.equal(history.searchParams.get("symbol"), "AAPL");
  assert.equal(history.searchParams.get("interval"), "daily");
  assert.match(history.searchParams.get("start"), /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(history.searchParams.get("end"), "2026-10-02");
  const intraday = await api.getHistory("AAPL", "10Min", stockHistoryRequest("10Min", 30));
  const timesales = calls[1];
  assert.match(timesales.search, /start=2026-09-25%2000%3A00/, "space is %20, never +");
  assert.equal(timesales.pathname, "/v1/markets/timesales");
  assert.equal(timesales.searchParams.get("interval"), "5min");
  assert.equal(timesales.searchParams.get("session_filter"), "all");
  assert.equal(timesales.searchParams.get("start"), "2026-09-25 00:00");
  assert.equal(timesales.searchParams.get("end"), "2026-10-02 11:07");
  assert.deepEqual(intraday.map((bar) => new Date(bar.t).toISOString().slice(11, 16)), ["14:00", "14:10", "14:20"]);
  const status = api.getStatus();
  assert.equal(status.history.state, "HEALTHY");
  assert.equal(status.history.lastInterval, "5min");
  assert.equal(status.historyRequestsInWindow, 2);
  assert.ok(!JSON.stringify(status).includes("tradier-secret"));
});

test("history failures carry a status for cooldown and an unconfigured adapter never fetches", async () => {
  let calls = 0;
  const unconfigured = createTradierMarketData({ apiKey: "", fetchImpl: async () => { calls++; return json({}); } });
  assert.equal(unconfigured.configured, false);
  await assert.rejects(unconfigured.getHistory("AAPL", "5Min", stockHistoryRequest("5Min", 30)), { code: "NOT_CONFIGURED" });
  assert.equal(calls, 0);
  const denied = createTradierMarketData({ apiKey: "k", fetchImpl: async () => json({ fault: {} }, { status: 401 }) });
  await assert.rejects(denied.getHistory("AAPL", "5Min", stockHistoryRequest("5Min", 30)), { status: 401 });
  assert.equal(denied.getStatus().authentication.state, "FAIL");
  const broken = createTradierMarketData({ apiKey: "k", fetchImpl: async () => new Response("{not json") });
  await assert.rejects(broken.getHistory("AAPL", "1Day", stockHistoryRequest("1Day", 25)), { code: "REQUEST_FAILED" });
  assert.equal(broken.getStatus().history.state, "DEGRADED");
  const stalled = createTradierMarketData({ apiKey: "k",
    fetchImpl: (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })))) });
  await assert.rejects(stalled.getHistory("AAPL", "5Min", stockHistoryRequest("5Min", 30), { timeoutMs: 20 }), { code: "TIMEOUT" });
});

test("one rate window and backoff covers quotes and history, with quotes keeping a reserve", async () => {
  const now = Date.parse("2026-10-02T15:00:00.000Z");
  let quoteCalls = 0, historyCalls = 0;
  const api = createTradierMarketData({ apiKey: "k", now: () => now, fetchImpl: async (url) => {
    if (url.includes("/markets/quotes")) { quoteCalls++; return json({ quotes: null }); }
    historyCalls++;
    return json({ history: null });
  } });
  const spec = stockHistoryRequest("1Day", 25);
  for (let i = 0; i < 60; i++) await api.getHistory("AAPL", "1Day", spec);
  await assert.rejects(api.getHistory("AAPL", "1Day", spec), { code: "LOCAL_RATE_BUDGET" });
  assert.equal(historyCalls, 60, "history stops at budget minus the quote reserve");
  await api.getLatestQuotes(["AAPL"]);
  assert.equal(quoteCalls, 1, "quotes still have their reserved share");

  let limitedQuoteCalls = 0;
  const limited = createTradierMarketData({ apiKey: "k", now: () => now, fetchImpl: async (url) => {
    if (url.includes("/markets/quotes")) { limitedQuoteCalls++; return json({ quotes: null }); }
    return json({}, { status: 429 });
  } });
  await assert.rejects(limited.getHistory("AAPL", "5Min", stockHistoryRequest("5Min", 30)), { status: 429 });
  assert.deepEqual(await limited.getLatestQuotes(["AAPL"]), []);
  assert.equal(limitedQuoteCalls, 0, "a history 429 backs off quotes too");
  assert.equal(limited.getStatus().lastSkipReason, "PROVIDER_BACKOFF");
  await assert.rejects(limited.getHistory("AAPL", "5Min", stockHistoryRequest("5Min", 30)), { code: "PROVIDER_BACKOFF" });
});

test("sandbox history uses the sandbox host and is marked delayed", async () => {
  let host = null;
  const api = createTradierMarketData({ apiKey: "k", sandbox: true, fetchImpl: async (url) => {
    host = new URL(url).hostname;
    return json({ history: { day: [day("2026-10-01")] } });
  } });
  await api.getHistory("AAPL", "1Day", stockHistoryRequest("1Day", 25));
  assert.equal(host, "sandbox.tradier.com");
  assert.equal(api.sandbox, true);
  assert.equal(api.getStatus().history.delayed, true);
});
