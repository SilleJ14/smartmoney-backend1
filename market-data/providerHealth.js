// Provider health is infrastructure. Evidence state is per symbol.
// A healthy provider can still have no quote for one name.
// A failed provider must not become a zero score.

const EMPTY_WINDOW = () => ({ requests: 0, successes: 0, timeouts: 0, rateLimits: 0, serverErrors: 0, reconnects: 0 });

export function createProviderHealth() {
  const providers = new Map();

  function ensure(name) {
    if (!providers.has(name)) {
      providers.set(name, {
        provider: name,
        state: "HEALTHY",
        authentication: { state: "UNKNOWN" },
        entitlement: null,
        feed: null,
        stream: { state: "UNKNOWN", connectedAt: null, lastEventAt: null },
        channels: {},
        errors: { recentCount: 0, lastError: null },
        throttling: { state: "CLEAR", retryAfter: null },
        windows: { m1: EMPTY_WINDOW(), m15: EMPTY_WINDOW(), h1: EMPTY_WINDOW() },
        latencyMs: [],
        lastSuccessAt: null,
        lastFailureAt: null,
        consecutiveFailures: 0,
      });
    }
    return providers.get(name);
  }

  function note(name, event = {}) {
    const row = ensure(name);
    const ok = event.ok !== false && event.timeout !== true && event.status !== 429 && !(event.status >= 500);
    for (const window of Object.values(row.windows)) {
      window.requests += 1;
      if (ok) window.successes += 1;
      if (event.timeout) window.timeouts += 1;
      if (event.status === 429) window.rateLimits += 1;
      if (event.status >= 500) window.serverErrors += 1;
      if (event.reconnect) window.reconnects += 1;
    }
    if (Number.isFinite(event.latencyMs)) {
      row.latencyMs.push(event.latencyMs);
      if (row.latencyMs.length > 200) row.latencyMs.shift();
    }
    if (ok) {
      row.lastSuccessAt = event.at || new Date().toISOString();
      row.consecutiveFailures = 0;
      row.state = row.state === "CIRCUIT_OPEN" ? "RECOVERING" : "HEALTHY";
      row.throttling = { state: "CLEAR", retryAfter: null };
      row.errors.lastError = null;
    } else {
      row.lastFailureAt = event.at || new Date().toISOString();
      row.consecutiveFailures += 1;
      row.errors.recentCount += 1;
      row.errors.lastError = event.error || (event.status === 429 ? "RATE_LIMITED" : "PROVIDER_ERROR");
      if (event.status === 429) row.throttling = { state: "LIMITED", retryAfter: event.retryAfter || null };
      row.state = row.consecutiveFailures >= 5 ? "CIRCUIT_OPEN" : "DEGRADED";
    }
    if (event.feed) row.feed = event.feed;
    if (event.entitlement) row.entitlement = event.entitlement;
    if (event.channel) {
      row.channels[event.channel] = {
        state: ok ? "HEALTHY" : event.timeout ? "DATA_UNAVAILABLE" : "DEGRADED",
        reason: ok ? null : event.error || (event.timeout ? "PROVIDER_TIMEOUT" : row.errors.lastError),
        lastSuccessAt: ok ? row.lastSuccessAt : row.channels[event.channel]?.lastSuccessAt || null,
        evidenceAgeMs: event.evidenceAgeMs ?? null,
        feed: event.feed || row.feed,
      };
    }
    return snapshot(name);
  }

  function snapshot(name) {
    const row = ensure(name);
    const sorted = [...row.latencyMs].sort((a, b) => a - b);
    const pick = (p) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * (sorted.length - 1)))] : null;
    return {
      provider: row.provider,
      state: row.state,
      authentication: row.authentication,
      entitlement: row.entitlement,
      feed: row.feed,
      stream: row.stream,
      channels: row.channels,
      errors: row.errors,
      throttling: row.throttling,
      availability1m: rate(row.windows.m1),
      availability15m: rate(row.windows.m15),
      availability1h: rate(row.windows.h1),
      p50Latency: pick(50),
      p95Latency: pick(95),
      lastSuccessAt: row.lastSuccessAt,
      lastFailureAt: row.lastFailureAt,
    };
  }

  return {
    note,
    snapshot,
    all: () => [...providers.keys()].map(snapshot),
    setAuth(name, state) { ensure(name).authentication = { state }; },
    setStream(name, stream) { Object.assign(ensure(name).stream, stream); },
  };
}

function rate(window) {
  if (!window.requests) return null;
  return Number((window.successes / window.requests).toFixed(2));
}

export function symbolEvidenceFromHealth({ providerHealthy = true, quoteReceived = false, covered = true } = {}) {
  if (!providerHealthy) return { state: "DATA_UNAVAILABLE", reason: "PROVIDER_UNAVAILABLE", score: null };
  if (!covered) return { state: "NOT_COVERED", reason: "NEWS_NOT_COVERED", score: null };
  if (!quoteReceived) return { state: "DATA_UNAVAILABLE", reason: "QUOTE_NOT_RECEIVED", score: null };
  return { state: "PASS", reason: null, score: null };
}

export function providerFailureDoesNotScore() {
  return { discovery: null, entry: null, final: null, state: "DATA_UNAVAILABLE", deteriorated: false };
}

export function stockDataHealth({ tradier = {}, massive = {}, alpaca = {} } = {}) {
  return {
    stocks: {
      tradier: {
        provider: "TRADIER",
        authentication: { state: tradier.authenticated === false ? "FAIL" : "PASS" },
        entitlement: { marketData: "REALTIME_CONSOLIDATED" },
        stream: tradier.stream || { state: "UNKNOWN" },
        quote: tradier.quote || { state: "UNKNOWN" },
        errors: tradier.errors || { recentCount: 0, lastError: null },
        throttling: tradier.throttling || { state: "CLEAR", retryAfter: null },
      },
      massive: {
        provider: "MASSIVE",
        feed: massive.delayed ? "DELAYED" : "REALTIME",
        websocket: massive.websocket || { state: "UNKNOWN" },
        bars: massive.bars || { state: "UNKNOWN" },
      },
      alpaca: {
        provider: "ALPACA",
        authentication: { state: alpaca.authenticated === false ? "FAIL" : "PASS" },
        stockFeedEntitlement: "IEX",
        role: "FALLBACK_AND_EXECUTION",
      },
    },
  };
}

export function cryptoChannelHealth({ quote, trades, bars, orderBook, news } = {}) {
  return {
    quote: quote || { state: "DATA_UNAVAILABLE" },
    trades: trades || { state: "DATA_UNAVAILABLE" },
    bars: bars || { state: "DATA_UNAVAILABLE" },
    orderBook: orderBook || { state: "DATA_UNAVAILABLE", reason: "ORDER_BOOK_UNAVAILABLE" },
    news: news || { state: "NOT_COVERED", reason: "NEWS_NOT_COVERED" },
  };
}
