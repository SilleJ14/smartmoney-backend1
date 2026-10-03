import { parseProviderTimestamp } from '../market-data/providerTimestamp.js';
import { quoteBookFromParts } from '../market-data/normalizedQuote.js';
import { cancelResponseBody, readBoundedResponseText } from '../utils/boundedResponse.js';

function fallbackIsNormalStockSymbol(symbol = "") {
  const clean = String(symbol || "").trim().toUpperCase();

  if (!clean) return false;
  if (clean.includes("/")) return false;
  if (clean.includes("-USD")) return false;
  if (clean.includes("USDT")) return false;
  if (clean.length > 7) return false;

  return /^[A-Z][A-Z0-9.-]*$/.test(clean);
}

function getStockSymbolValidator(isNormalStockSymbol) {
  return typeof isNormalStockSymbol === "function"
    ? isNormalStockSymbol
    : fallbackIsNormalStockSymbol;
}

export function createEmptyPolygonMoversCache(reason = "") {
  return {
    at: 0,
    symbols: [],
    gainers: [],
    losers: [],
    moverDetails: {},
    reason,
  };
}

export function updatePolygonMoversCache({
  symbols = [],
  gainers = [],
  losers = [],
  ranked = [],
  reason = "",
  normalizeSymbol,
}) {
  return {
    at: Date.now(),
    symbols,
    gainers,
    losers,
    moverDetails: Object.fromEntries(
      ranked
        .filter((item) => item.symbol)
        .map((item) => [normalizeSymbol(item.symbol), item])
    ),
    reason,
  };
}

export function parsePolygonSnapshotTickers({
  tickers = [],
  normalizeSymbol,
  isNormalStockSymbol,
}) {
  const validateStockSymbol =
    getStockSymbolValidator(isNormalStockSymbol);

  return tickers
    .map((ticker) => {
      const symbol = normalizeSymbol(ticker?.ticker);

      const current = Number(
        ticker?.lastTrade?.p ||
        ticker?.day?.c ||
        0
      );

      const rawPercentChange = Number(
        ticker?.todaysChangePerc || 0
      );

      const previousClose = Number(
        ticker?.prevDay?.c ||
        (
          current > 0 && rawPercentChange !== 0
            ? current / (1 + rawPercentChange / 100)
            : 0
        )
      );

      const percentChange =
        Number.isFinite(rawPercentChange) && rawPercentChange !== 0
          ? rawPercentChange
          : previousClose > 0 && current > 0
            ? ((current - previousClose) / previousClose) * 100
            : 0;

      const volume = Number(ticker?.day?.v || 0);
      // A last trade owns its own clock; snapshot update time cannot freshen it.
      const providerTime = parseProviderTimestamp(ticker?.lastTrade?.p > 0
        ? ticker.lastTrade.t : ticker?.updated);

      return {
        symbol,
        current,
        price: current,
        previousClose,
        dayOpen: Number(
          ticker?.day?.o || previousClose || 0
        ),
        percentChange,
        volume,
        liveQuoteUpdatedAt: providerTime,
        updatedAt: providerTime,
        priceIsLive: false,
        liveQuoteSource: 'polygon_snapshot',
        direction:
          percentChange > 0
            ? "GAINER"
            : percentChange < 0
              ? "LOSER"
              : "FLAT",
      };
    })
    .filter((item) => validateStockSymbol(item.symbol))
    .filter((item) =>
      Number.isFinite(item.percentChange)
    );
}

export function rankPolygonMovers({
  rankedRaw = [],
  limit = 100,
}) {
  const gainers = rankedRaw
    .filter((item) => item.percentChange > 0)
    .sort((a, b) => b.percentChange - a.percentChange)
    .slice(0, limit);

  const losers = rankedRaw
    .filter((item) => item.percentChange < 0)
    .sort((a, b) => a.percentChange - b.percentChange)
    .slice(
      0,
      Math.max(10, Math.floor(limit * 0.25))
    );

  const ranked = [...gainers, ...losers].slice(0, limit);

  return {
    gainers,
    losers,
    ranked,
  };
}

export function buildNormalizedSymbolList({
  items = [],
  normalizeSymbol,
  isNormalStockSymbol,
}) {
  const validateStockSymbol =
    getStockSymbolValidator(isNormalStockSymbol);

  return items
    .map((item) => item.symbol)
    .filter(Boolean)
    .map(normalizeSymbol)
    .filter(validateStockSymbol);
}

export function buildPolygonFallbackSymbols({
  engineState,
  normalizeSymbol,
  isNormalStockSymbol,
}) {
  const validateStockSymbol =
    getStockSymbolValidator(isNormalStockSymbol);

  const preMoverFallbackSymbols = [
    ...(engineState.preMoverDiscoveryState?.topCandidates || []).map(
      (s) => s.symbol || s
    ),
    ...Object.values(
      engineState.preMoverDiscoveryMemory || {}
    ).map((s) => s.symbol || s),
  ]
    .filter(Boolean)
    .map(normalizeSymbol)
    .filter(validateStockSymbol);

  const runnerFallbackSymbols = [
    ...(engineState.fastRunnerCandidates || []).map(
      (s) => s.symbol
    ),
    ...(engineState.quickInstitutionalCandidates || []).map(
      (s) => s.symbol
    ),
    ...(engineState.institutionalWatchlist || []).map(
      (s) => s.symbol || s
    ),
    ...(engineState.lastStockSignals || []).map(
      (s) => s.symbol
    ),
    ...(engineState.topStockSignals || []).map(
      (s) => s.symbol
    ),
  ]
    .filter(Boolean)
    .map(normalizeSymbol)
    .filter(validateStockSymbol);

  return {
    preMoverFallbackSymbols,
    runnerFallbackSymbols,
  };
}

// ---------------------------------------------------------------------------
// Batch stock quotes: the fallback for symbols Tradier did not serve fresh.
// Market data only. Polygon (Massive) is consolidated SIP data, but the account
// plan may be real-time or 15-minute delayed, so timing is judged ONLY from the
// provider's own nanosecond clocks, never from receipt time or provider name.
export const POLYGON_STOCK_SNAPSHOT_SOURCE = "polygon_stock_snapshot";
export const POLYGON_DELAYED_SNAPSHOT_SOURCE = "polygon_delayed_snapshot";
// Evidence older than this cannot be told apart from a delayed entitlement.
export const POLYGON_REALTIME_MAX_AGE_MS = 60 * 1000;
const POLYGON_SNAPSHOT_URL = "https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers";
const POLYGON_MAX_QUOTE_SYMBOLS = 120;
const POLYGON_QUOTE_MAX_BYTES = 1024 * 1024;
const POLYGON_LIVE_PRICE_MAX_AGE_MS = 5000;
const POLYGON_QUOTE_SYMBOL = /^[A-Z][A-Z0-9.-]{0,9}$/;
const MIN_PROVIDER_EPOCH_MS = Date.UTC(2000, 0, 1);

function positiveNumber(value) {
  if (value === null || value === undefined || value === "" || typeof value === "boolean") return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

// Snapshot clocks (lastQuote.t, lastTrade.t) are SIP nanoseconds. Coarser units
// are tolerated by magnitude. Invalid, pre-2000 or future (>5 s skew) => null.
export function polygonTimestampMs(value, now = Date.now()) {
  if (value === null || value === undefined || value === "" || typeof value === "boolean") return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  const ms = Math.floor(number >= 1e17 ? number / 1e6 : number >= 1e14 ? number / 1e3 : number >= 1e11 ? number : number * 1000);
  return ms >= MIN_PROVIDER_EPOCH_MS && ms <= Number(now) + 5000 ? ms : null;
}

// Same shape as normalizeTradierQuote so the quote batch, cache and execution
// gates treat both providers identically.
export function normalizePolygonSnapshotQuote(raw = {}, { now = Date.now(), delayed: planDelayed = false } = {}) {
  if (!raw || typeof raw !== "object") return null;
  const symbol = String(raw.ticker || "").trim().toUpperCase();
  if (!POLYGON_QUOTE_SYMBOL.test(symbol)) return null;
  const nbbo = plainObject(raw.lastQuote);
  const print = plainObject(raw.lastTrade);
  const day = plainObject(raw.day);
  const prevDay = plainObject(raw.prevDay);
  // v2 snapshot NBBO: p = bid, P = ask, s/S = sizes. bp/ap are legacy aliases.
  const bid = positiveNumber(nbbo.p ?? nbbo.bp);
  const ask = positiveNumber(nbbo.P ?? nbbo.ap);
  const quoteTime = bid !== null || ask !== null ? polygonTimestampMs(nbbo.t, now) : null;
  const last = positiveNumber(print.p);
  const tradeTime = last !== null ? polygonTimestampMs(print.t, now) : null;
  const pairMeasured = bid !== null && ask !== null && ask >= bid && quoteTime !== null;
  const newestEvidence = Math.max(quoteTime ?? -Infinity, tradeTime ?? -Infinity);
  // Fail safe: no provider clock, an old clock or a DELAYED response is delayed.
  const delayed = planDelayed === true || !Number.isFinite(newestEvidence) ||
    now - newestEvidence > POLYGON_REALTIME_MAX_AGE_MS;
  const spreadAvailable = pairMeasured && !delayed;
  // Select price and its own timestamp atomically. Never attach a trade time to a pair.
  const useMid = pairMeasured && (tradeTime === null || quoteTime >= tradeTime);
  const price = useMid ? (bid + ask) / 2 : last;
  const priceTime = useMid ? quoteTime : tradeTime;
  if (price === null || priceTime === null) return null;
  const previousClose = positiveNumber(prevDay.c);
  const source = delayed ? POLYGON_DELAYED_SNAPSHOT_SOURCE : POLYGON_STOCK_SNAPSHOT_SOURCE;
  const iso = (time) => time === null ? null : new Date(time).toISOString();
  const priceAgeMs = now - priceTime;
  return {
    symbol, assetClass: "stock", price, current: price, livePrice: price,
    lastTradePrice: last, tradeUpdatedAt: iso(tradeTime),
    previousClose, open: positiveNumber(day.o), high: positiveNumber(day.h), low: positiveNumber(day.l),
    volume: Math.max(0, Number(day.v) || 0),
    percentChange: previousClose ? ((price - previousClose) / previousClose) * 100 : null,
    percentChangeAvailable: previousClose !== null,
    percentChangeReferencePrice: previousClose, percentChangeSource: source,
    bid: spreadAvailable ? bid : 0, ask: spreadAvailable ? ask : 0,
    ...quoteBookFromParts({
      bidPrice: bid,
      askPrice: ask,
      bidSize: nbbo.s ?? nbbo.bs,
      askSize: nbbo.S ?? nbbo.as,
      quoteTimestamp: iso(pairMeasured ? quoteTime : null),
      lastTradePrice: last,
      lastTradeSize: print.s,
      lastTradeTimestamp: iso(tradeTime),
      provider: "MASSIVE",
      feed: "snapshot",
      tapeFeed: "CONSOLIDATED",
      // Snapshot NBBO size units are not documented consistently (lots vs shares).
      sizeUnit: "unknown",
      tradeSizeUnit: "shares",
    }),
    bidUpdatedAt: bid !== null ? iso(quoteTime) : null, askUpdatedAt: ask !== null ? iso(quoteTime) : null,
    spreadAvailable, spreadPercent: spreadAvailable ? ((ask - bid) / ((ask + bid) / 2)) * 100 : null,
    spreadUpdatedAt: spreadAvailable ? iso(quoteTime) : null,
    bidAskUpdatedAt: spreadAvailable ? iso(quoteTime) : null, spreadSource: source,
    liveQuoteUpdatedAt: iso(priceTime), quoteUpdatedAt: iso(priceTime), quoteFetchedAt: iso(priceTime),
    source, liveQuoteSource: source,
    priceIsLive: !delayed && priceAgeMs >= -5000 && priceAgeMs <= POLYGON_LIVE_PRICE_MAX_AGE_MS,
    receivedAt: iso(now), delayed, timing: delayed ? "DELAYED" : "REALTIME",
  };
}

function retryAfterMs(response, now) {
  const value = response?.headers?.get?.("retry-after");
  if (value === null || value === undefined || value === "") return null;
  const ms = /^\d+(\.\d+)?$/.test(String(value)) ? Number(value) * 1000 : Date.parse(value) - now;
  return Number.isFinite(ms) && ms > 0 ? ms : null;
}

function providerFailure(reason, backoffMs = null) {
  return Object.assign(new Error(reason), { reason, backoffMs });
}

export function createPolygonStockQuotes({
  apiKey = process.env.POLYGON_API_KEY,
  enabled = process.env.ENABLE_POLYGON !== "false",
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = Date.now,
  // Polygon limits are per account: honour and set the server-wide cooldown.
  isSharedCooldownActive = () => false,
  onRateLimited = () => {},
  maxRequestsPerMinute = 60,
  defaultTimeoutMs = 2000,
} = {}) {
  const configured = Boolean(enabled && apiKey);
  let blockedUntil = 0;
  let windowStart = 0;
  let requests = 0;
  let consecutiveFailures = 0;
  const pending = new Map();
  let status = {
    provider: "MASSIVE",
    role: "STOCK_QUOTE_FALLBACK",
    configured,
    enabled: Boolean(enabled),
    authentication: { state: apiKey ? "UNKNOWN" : "FAIL" },
    entitlement: { marketData: "UNKNOWN" },
    quote: { state: configured ? "UNKNOWN" : "DATA_UNAVAILABLE", lastSuccessAt: null },
    lastSuccessAt: null,
    lastError: configured ? null : "NOT_CONFIGURED",
    lastHttpStatus: null,
    lastLatencyMs: null,
    lastSkipReason: null,
    returnedCount: 0,
    realtimeCount: 0,
    delayedCount: 0,
  };
  const backoff = (ms) => { blockedUntil = Math.max(blockedUntil, now() + ms); };

  async function getLatestQuotes(symbols = [], { signal = null, timeoutMs = defaultTimeoutMs } = {}) {
    const list = Array.isArray(symbols) ? symbols : [symbols];
    const selected = [...new Set(list.map((s) => String(s ?? "").trim().toUpperCase()))]
      .filter((s) => POLYGON_QUOTE_SYMBOL.test(s)).slice(0, POLYGON_MAX_QUOTE_SYMBOLS).sort();
    if (!configured || !selected.length || signal?.aborted) return [];
    const key = selected.join(",");
    if (pending.has(key)) return pending.get(key);
    const time = now();
    if (time < blockedUntil) { status = { ...status, lastSkipReason: "PROVIDER_BACKOFF" }; return []; }
    if (isSharedCooldownActive()) { status = { ...status, lastSkipReason: "SHARED_POLYGON_COOLDOWN" }; return []; }
    if (time - windowStart >= 60000) { windowStart = time; requests = 0; }
    if (requests >= maxRequestsPerMinute) { status = { ...status, lastSkipReason: "LOCAL_RATE_BUDGET" }; return []; }
    requests += 1;
    const budgetMs = Math.max(1, Math.min(5000, Number(timeoutMs) || defaultTimeoutMs));
    const request = (async () => {
      const startedAt = now();
      const deadline = Date.now() + budgetMs;
      const controller = new AbortController();
      const abortFromCaller = () => controller.abort();
      signal?.addEventListener?.("abort", abortFromCaller, { once: true });
      const timer = setTimeout(() => controller.abort(), budgetMs);
      try {
        // Key in a header, never in a URL that could reach a log or error.
        const response = await fetchImpl(`${POLYGON_SNAPSHOT_URL}?tickers=${encodeURIComponent(key)}`, {
          headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" }, signal: controller.signal,
        });
        const httpStatus = Number(response?.status) || 0;
        status = {
          ...status,
          authentication: { state: httpStatus === 401 || httpStatus === 403 ? "FAIL" : "PASS" },
          lastHttpStatus: httpStatus,
        };
        if (httpStatus === 401 || httpStatus === 403) {
          cancelResponseBody(response);
          if (httpStatus === 403) status = { ...status, entitlement: { marketData: "NOT_AUTHORIZED" } };
          throw providerFailure(httpStatus === 403 ? "POLYGON_NOT_AUTHORIZED" : "POLYGON_AUTH_FAILED", 5 * 60000);
        }
        if (httpStatus === 429) {
          cancelResponseBody(response);
          onRateLimited();
          throw providerFailure("POLYGON_RATE_LIMITED", Math.min(5 * 60000, retryAfterMs(response, now()) ?? 60000));
        }
        if (!response?.ok) {
          cancelResponseBody(response);
          throw providerFailure(`POLYGON_HTTP_${httpStatus || "ERROR"}`);
        }
        const text = await readBoundedResponseText(response, {
          maxBytes: POLYGON_QUOTE_MAX_BYTES, timeoutMs: Math.max(1, deadline - Date.now()),
        });
        let payload;
        try { payload = JSON.parse(text); } catch { throw providerFailure("POLYGON_MALFORMED_RESPONSE"); }
        if (!payload || typeof payload !== "object" || (payload.tickers != null && !Array.isArray(payload.tickers))) {
          throw providerFailure("POLYGON_MALFORMED_RESPONSE");
        }
        const planDelayed = String(payload.status || "").toUpperCase() === "DELAYED";
        const wanted = new Set(selected);
        const quotes = [];
        const at = now();
        for (const row of payload.tickers || []) {
          const symbol = String(row?.ticker || "").trim().toUpperCase();
          if (!wanted.has(symbol)) continue;
          wanted.delete(symbol);
          const quote = normalizePolygonSnapshotQuote(row, { now: at, delayed: planDelayed });
          if (quote) quotes.push(quote);
        }
        const completedAt = now();
        const realtimeCount = quotes.filter((quote) => quote.timing === "REALTIME").length;
        consecutiveFailures = 0;
        status = {
          ...status,
          entitlement: {
            marketData: planDelayed ? "DELAYED" : realtimeCount ? "REALTIME_CONSOLIDATED"
              : status.entitlement.marketData === "NOT_AUTHORIZED" ? "UNKNOWN" : status.entitlement.marketData,
          },
          quote: {
            state: !quotes.length ? "DATA_UNAVAILABLE" : realtimeCount ? "HEALTHY" : "DELAYED_OR_STALE",
            lastSuccessAt: quotes.length ? new Date(completedAt).toISOString() : status.quote?.lastSuccessAt || null,
          },
          lastSuccessAt: quotes.length ? new Date(completedAt).toISOString() : status.lastSuccessAt,
          lastLatencyMs: Math.max(0, completedAt - startedAt),
          lastError: quotes.length ? null : "NO_VALID_QUOTES",
          lastSkipReason: null,
          returnedCount: quotes.length,
          realtimeCount,
          delayedCount: quotes.length - realtimeCount,
        };
        return quotes;
      } catch (error) {
        // Never expose URLs, headers or provider payloads in status.
        const callerAborted = signal?.aborted === true && !error?.reason;
        const reason = error?.reason || (callerAborted ? "POLYGON_CALLER_ABORTED"
          : error?.name === "AbortError" || controller.signal.aborted ? "POLYGON_TIMEOUT" : "POLYGON_REQUEST_FAILED");
        if (Number.isFinite(error?.backoffMs)) backoff(error.backoffMs);
        else if (!callerAborted) {
          consecutiveFailures += 1;
          backoff(Math.min(60000, 5000 * 2 ** Math.min(4, consecutiveFailures - 1)));
        }
        status = {
          ...status,
          quote: { ...status.quote, state: "DEGRADED" },
          lastLatencyMs: Math.max(0, now() - startedAt),
          lastError: reason,
        };
        return [];
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener?.("abort", abortFromCaller);
      }
    })().finally(() => pending.delete(key));
    pending.set(key, request);
    return request;
  }

  return {
    configured,
    getLatestQuotes,
    getStatus: () => ({ ...status, requestsInWindow: requests, blockedUntil }),
  };
}
