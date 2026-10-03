import { normalizeTradierRestBook } from "../market-data/normalizedQuote.js";

// Market-data only. No account, order or trading endpoints belong in this adapter.
const LIVE_BASE = "https://api.tradier.com/v1";
const SANDBOX_BASE = "https://sandbox.tradier.com/v1";
const MAX_SYMBOLS = 120;
const QUOTE_MAX_BYTES = 2 * 1024 * 1024;
const HISTORY_MAX_BYTES = 3 * 1024 * 1024;
const HISTORY_DAILY_LOOKBACK_DAYS = 120;
const HISTORY_INTRADAY_LOOKBACK_DAYS = 7;
const SYMBOL = /^[A-Z][A-Z0-9.-]{0,9}$/;
// Tradier allows about 120 market-data requests a minute (sandbox 60) across
// quotes, history and timesales. One local window covers all of them, and
// history may never use the share reserved for quotes.
const REQUEST_BUDGET = Object.freeze({ live: 90, sandbox: 45 });
const QUOTE_RESERVE = Object.freeze({ live: 30, sandbox: 15 });
const finitePositive = (value) => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : null;
const timestamp = (value, now) => {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  const ms = Number.isFinite(number) ? (number < 1e10 ? number * 1000 : number) : Date.parse(value);
  return Number.isFinite(ms) && ms > 0 && ms <= now + 5000 ? ms : null;
};

export function normalizeTradierQuote(raw = {}, { now = Date.now(), sandbox = false } = {}) {
  const symbol = String(raw.symbol || "").trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol) || !["stock", "etf"].includes(raw.type)) return null;
  const bid = finitePositive(raw.bid);
  const ask = finitePositive(raw.ask);
  const bidTime = timestamp(raw.bid_date, now);
  const askTime = timestamp(raw.ask_date, now);
  const tradeTime = timestamp(raw.trade_date, now);
  const spreadTime = bidTime !== null && askTime !== null ? Math.min(bidTime, askTime) : null;
  const spreadAvailable = bid !== null && ask !== null && ask >= bid && spreadTime !== null && !sandbox;
  const last = finitePositive(raw.last);
  // Select price and its own timestamp atomically. Never attach trade time to a pair.
  const useMid = spreadAvailable && (tradeTime === null || spreadTime >= tradeTime);
  const price = useMid ? (bid + ask) / 2 : last;
  const priceTime = useMid ? spreadTime : tradeTime;
  if (price === null || priceTime === null) return null;
  const previousClose = finitePositive(raw.prevclose);
  const source = sandbox ? "tradier_delayed_quote" : "tradier_stock_quote";
  const iso = (time) => time === null ? null : new Date(time).toISOString();
  return {
    symbol, assetClass: "stock", price, current: price, livePrice: price,
    lastTradePrice: last, tradeUpdatedAt: iso(tradeTime),
    previousClose, open: finitePositive(raw.open), high: finitePositive(raw.high), low: finitePositive(raw.low),
    volume: Math.max(0, Number(raw.volume) || 0), averageVolume: Math.max(0, Number(raw.average_volume) || 0),
    percentChange: previousClose ? ((price - previousClose) / previousClose) * 100 : null,
    percentChangeAvailable: previousClose !== null,
    percentChangeReferencePrice: previousClose, percentChangeSource: source,
    bid: spreadAvailable ? bid : 0, ask: spreadAvailable ? ask : 0,
    ...normalizeTradierRestBook(raw, iso(spreadTime)),
    bidUpdatedAt: iso(bidTime), askUpdatedAt: iso(askTime),
    spreadAvailable, spreadPercent: spreadAvailable ? ((ask - bid) / ((ask + bid) / 2)) * 100 : null,
    spreadUpdatedAt: spreadAvailable ? iso(spreadTime) : null,
    bidAskUpdatedAt: spreadAvailable ? iso(spreadTime) : null, spreadSource: source,
    liveQuoteUpdatedAt: iso(priceTime), quoteUpdatedAt: iso(priceTime), quoteFetchedAt: iso(priceTime),
    source, liveQuoteSource: source, priceIsLive: !sandbox && now - priceTime <= 5000,
    receivedAt: iso(now), delayed: sandbox,
  };
}

// ---------------------------------------------------------------------------
// History. Bars use the shared contract {t (ms, bar START, UTC epoch), o, h, l, c, v}.

const easternFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

function easternParts(ms) {
  const parts = Object.fromEntries(easternFormatter.formatToParts(new Date(ms))
    .filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

// A Tradier daily row names an exchange-local trading day. Stamp it at 00:00
// America/New_York (DST aware), the same convention as Polygon and Alpaca daily
// bars, so `t + 1 day <= now` marks it complete only after that session.
export function easternSessionDayStartMs(dateKey) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey || ""));
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  for (const offsetHours of [5, 4]) { // EST, then EDT
    const candidate = Date.UTC(year, month - 1, day, offsetHours);
    const local = easternParts(candidate);
    if (local.date === dateKey && local.time === "00:00") return candidate;
  }
  return null;
}

// Tradier timesales offers 1min, 5min and 15min. A requested N-minute bar uses
// the largest of those that divides N and is aggregated from it; every base bar
// then falls inside exactly one epoch-aligned N-minute bucket.
export function tradierHistoryPlan(spec = {}) {
  if (spec?.daily === true) return { endpoint: "history", interval: "daily", baseMinutes: null, minutes: null };
  const minutes = Number(spec?.multiplier);
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 60 || spec?.timespan !== "minute") return null;
  const baseMinutes = minutes % 15 === 0 ? 15 : minutes % 5 === 0 ? 5 : 1;
  return { endpoint: "timesales", interval: `${baseMinutes}min`, baseMinutes, minutes };
}

function rowsOf(value) {
  return Array.isArray(value) ? value : value && typeof value === "object" ? [value] : [];
}

function barFrom(t, row) {
  return { t, o: Number(row?.open), h: Number(row?.high), l: Number(row?.low), c: Number(row?.close), v: Number(row?.volume) };
}

function usableBar(bar) {
  return [bar.o, bar.h, bar.l, bar.c, bar.v].every(Number.isFinite) &&
    Math.min(bar.o, bar.h, bar.l, bar.c) > 0 && bar.v >= 0 &&
    bar.h >= Math.max(bar.o, bar.c, bar.l) && bar.l <= Math.min(bar.o, bar.c);
}

export function normalizeTradierDailyBars(payload = {}) {
  return rowsOf(payload?.history?.day).map((row) => {
    const t = easternSessionDayStartMs(row?.date);
    return t === null ? null : barFrom(t, row);
  }).filter(Boolean).sort((a, b) => a.t - b.t);
}

export function normalizeTradierTimesales(payload = {}, { baseMinutes, minutes, windowStartMs = -Infinity } = {}) {
  const baseMs = Number(baseMinutes) * 60000;
  const sizeMs = Number(minutes) * 60000;
  if (!(baseMs > 0) || !(sizeMs > 0) || sizeMs % baseMs !== 0) return [];
  const seen = new Set();
  const base = [];
  for (const row of rowsOf(payload?.series?.data)) {
    // `timestamp` is the bar-start epoch in seconds; `time` is ET wall-clock
    // text without an offset and is never parsed.
    const seconds = Number(row?.timestamp);
    if (!Number.isFinite(seconds) || seconds <= 0) continue;
    const t = Math.round(seconds * 1000);
    if (t % baseMs !== 0 || seen.has(t)) continue;
    seen.add(t);
    base.push(barFrom(t, row));
  }
  base.sort((a, b) => a.t - b.t);
  if (sizeMs === baseMs) return base;
  const buckets = new Map();
  const poisoned = new Set();
  for (const bar of base) {
    const start = Math.floor(bar.t / sizeMs) * sizeMs;
    if (start < windowStartMs) continue;
    // One unusable base bar makes the whole composite bar unknown.
    if (!usableBar(bar)) { poisoned.add(start); continue; }
    const bucket = buckets.get(start);
    if (!bucket) buckets.set(start, { ...bar, t: start });
    else {
      bucket.h = Math.max(bucket.h, bar.h);
      bucket.l = Math.min(bucket.l, bar.l);
      bucket.c = bar.c;
      bucket.v += bar.v;
    }
  }
  return [...buckets.values()].filter((bar) => !poisoned.has(bar.t));
}

function historyError(code, status = null) {
  return Object.assign(new Error(`Tradier history ${code}`), { code, ...(status ? { status } : {}) });
}

async function readJson(response, controller, maxBytes) {
  if (response.body?.[Symbol.asyncIterator]) {
    const chunks = [];
    let bytes = 0;
    for await (const chunk of response.body) {
      bytes += chunk.byteLength;
      if (bytes > maxBytes) { controller.abort(); throw new Error("Response budget exceeded"); }
      chunks.push(Buffer.from(chunk));
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  }
  return response.json();
}

export function createTradierMarketData({ apiKey = process.env.TRADIER_API_KEY,
  sandbox = process.env.TRADIER_SANDBOX === "true", fetchImpl = fetch, now = Date.now } = {}) {
  let blockedUntil = 0;
  let windowStart = 0;
  let requests = 0;
  let historyRequests = 0;
  const pending = new Map();
  const budget = sandbox ? REQUEST_BUDGET.sandbox : REQUEST_BUDGET.live;
  const quoteReserve = sandbox ? QUOTE_RESERVE.sandbox : QUOTE_RESERVE.live;
  const base = sandbox ? SANDBOX_BASE : LIVE_BASE;
  let status = {
    configured: Boolean(apiKey),
    sandbox,
    authentication: { state: apiKey ? "UNKNOWN" : "FAIL" },
    entitlement: { marketData: sandbox ? "DELAYED" : "UNKNOWN" },
    quote: { state: "UNKNOWN", lastSuccessAt: null },
    history: { state: apiKey ? "UNKNOWN" : "DATA_UNAVAILABLE", lastSuccessAt: null, lastError: null,
      lastSkipReason: null, lastInterval: null, lastBarCount: null, delayed: sandbox },
    lastSuccessAt: null,
    lastError: null,
    lastLatencyMs: null,
  };
  // One window and one provider backoff for every market-data call.
  function admit(kind) {
    const time = now();
    if (time < blockedUntil) return "PROVIDER_BACKOFF";
    if (time - windowStart >= 60000) { windowStart = time; requests = 0; historyRequests = 0; }
    if (requests >= (kind === "history" ? budget - quoteReserve : budget)) return "LOCAL_RATE_BUDGET";
    requests += 1;
    if (kind === "history") historyRequests += 1;
    return null;
  }
  function noteRateLimit(response) {
    const available = response.headers?.get?.("x-ratelimit-available");
    if (response.status === 429 || (available !== null && available !== undefined && Number(available) === 0)) {
      const expiry = Number(response.headers?.get?.("x-ratelimit-expiry"));
      blockedUntil = Math.min(now() + 60000, Math.max(now() + 1000,
        Number.isFinite(expiry) && expiry > now() ? expiry : now() + 60000));
    }
  }

  async function getLatestQuotes(symbols = []) {
    const selected = [...new Set(symbols.map((s) => String(s).trim().toUpperCase()))]
      .filter((s) => SYMBOL.test(s)).slice(0, MAX_SYMBOLS).sort();
    if (!apiKey || !selected.length) return [];
    const key = selected.join(",");
    if (pending.has(key)) return pending.get(key);
    const skip = admit("quote");
    if (skip) { status = { ...status, lastSkipReason: skip }; return []; }
    const request = (async () => {
      const startedAt = now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2000);
      try {
        const response = await fetchImpl(`${base}/markets/quotes?symbols=${encodeURIComponent(key)}`, {
          headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" }, signal: controller.signal,
        });
        status = {
          ...status,
          authentication: { state: response.status === 401 || response.status === 403 ? "FAIL" : "PASS" },
          lastHttpStatus: response.status,
        };
        noteRateLimit(response);
        if (!response.ok) throw new Error(`Tradier market data HTTP ${response.status}`);
        const payload = await readJson(response, controller, QUOTE_MAX_BYTES);
        const rows = payload?.quotes?.quote;
        const quotes = (Array.isArray(rows) ? rows : rows ? [rows] : []).slice(0, MAX_SYMBOLS)
          .filter((row) => selected.includes(row.symbol))
          .map((row) => normalizeTradierQuote(row, { now: now(), sandbox })).filter(Boolean);
        const completedAt = now();
        status = {
          ...status,
          entitlement: { marketData: sandbox ? "DELAYED" : "REALTIME_CONSOLIDATED" },
          quote: {
            state: quotes.length ? "HEALTHY" : "DATA_UNAVAILABLE",
            lastSuccessAt: quotes.length ? new Date(completedAt).toISOString() : status.quote?.lastSuccessAt || null,
          },
          lastSuccessAt: quotes.length ? new Date(completedAt).toISOString() : status.lastSuccessAt,
          lastLatencyMs: Math.max(0, completedAt - startedAt),
          lastError: quotes.length ? null : "NO_VALID_QUOTES",
          lastSkipReason: null,
          returnedCount: quotes.length,
        };
        return quotes;
      } catch (error) {
        // Never include URLs, headers or provider payloads in errors exposed to the app.
        status = {
          ...status,
          quote: { ...status.quote, state: "DEGRADED" },
          lastLatencyMs: Math.max(0, now() - startedAt),
          lastError: error?.name === "AbortError" ? "TRADIER_TIMEOUT" : "TRADIER_REQUEST_FAILED",
        };
        blockedUntil = Math.max(blockedUntil, now() + 5000);
        return [];
      } finally { clearTimeout(timer); }
    })().finally(() => pending.delete(key));
    pending.set(key, request);
    return request;
  }

  // createStockHistory fetcher: (symbol, timeframe, spec, options). Throws so the
  // caller records the reason and moves on to the next provider; never splices.
  async function getHistory(symbol, timeframe, spec, options = {}) {
    const clean = String(symbol || "").trim().toUpperCase();
    if (!apiKey) throw historyError("NOT_CONFIGURED");
    if (!SYMBOL.test(clean)) throw historyError("INVALID_SYMBOL");
    const plan = tradierHistoryPlan(spec);
    if (!plan) throw historyError("UNSUPPORTED_INTERVAL");
    const skip = admit("history");
    if (skip) {
      status = { ...status, history: { ...status.history, lastSkipReason: skip } };
      throw historyError(skip);
    }
    const time = now();
    const lookbackDays = plan.endpoint === "history" ? HISTORY_DAILY_LOOKBACK_DAYS : HISTORY_INTRADAY_LOOKBACK_DAYS;
    const from = easternParts(time - lookbackDays * 86400000);
    const to = easternParts(time);
    // Percent-encode (space => %20, not "+") so "YYYY-MM-DD HH:MM" survives any decoder.
    const params = Object.entries(plan.endpoint === "history"
      ? { symbol: clean, interval: "daily", start: from.date, end: to.date }
      : { symbol: clean, interval: plan.interval, start: `${from.date} 00:00`, end: `${to.date} ${to.time}`, session_filter: "all" })
      .map(([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(value)}`).join("&");
    const timeoutMs = Math.max(1, Math.min(10000, Number(options.timeoutMs) || 3500));
    const maxBytes = Math.max(1, Math.min(HISTORY_MAX_BYTES, Number(options.maxResponseBytes) || HISTORY_MAX_BYTES));
    const controller = new AbortController();
    const abortFromCaller = () => controller.abort();
    options.signal?.addEventListener?.("abort", abortFromCaller, { once: true });
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`${base}/markets/${plan.endpoint}?${params}`, {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" }, signal: controller.signal,
      });
      if (response.status === 401 || response.status === 403) {
        status = { ...status, authentication: { state: "FAIL" }, lastHttpStatus: response.status };
      }
      noteRateLimit(response);
      if (!response.ok) throw historyError("HTTP_ERROR", Number(response.status) || 502);
      const payload = await readJson(response, controller, maxBytes);
      if (!payload || typeof payload !== "object") throw historyError("MALFORMED_RESPONSE");
      const bars = plan.endpoint === "history"
        ? normalizeTradierDailyBars(payload)
        : normalizeTradierTimesales(payload, { ...plan, windowStartMs: easternSessionDayStartMs(from.date) ?? -Infinity });
      status = {
        ...status,
        authentication: { state: "PASS" },
        history: { ...status.history, state: bars.length ? "HEALTHY" : "DATA_UNAVAILABLE",
          lastSuccessAt: bars.length ? new Date(now()).toISOString() : status.history.lastSuccessAt,
          lastError: bars.length ? null : "NO_BARS", lastSkipReason: null, lastInterval: plan.interval,
          lastBarCount: bars.length, delayed: sandbox },
      };
      return bars;
    } catch (error) {
      const code = error?.code && typeof error.code === "string" ? error.code
        : error?.name === "AbortError" ? "TIMEOUT" : "REQUEST_FAILED";
      status = { ...status, history: { ...status.history, state: "DEGRADED", lastError: `TRADIER_HISTORY_${code}` } };
      if (error?.code && typeof error.code === "string") throw error;
      throw historyError(code);
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener?.("abort", abortFromCaller);
    }
  }

  return {
    configured: Boolean(apiKey),
    sandbox,
    getLatestQuotes,
    getHistory,
    getStatus: () => ({ ...status, requestsInWindow: requests, historyRequestsInWindow: historyRequests,
      requestBudget: budget, quoteReserve, blockedUntil }),
  };
}
