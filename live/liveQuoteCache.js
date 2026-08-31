const LIVE_QUOTE_SOURCE_REGISTRY = Object.freeze({
  polygon_ws_trade: { provider: "polygon", assets: ["stock"], connection: "polygon" },
  polygon_ws_quote: { provider: "polygon", assets: ["stock"], connection: "polygon" },
  polygon_ws_second_aggregate: { provider: "polygon", assets: ["stock"], connection: "polygon" },
  polygon_rest_quote: { provider: "polygon", assets: ["stock"] },
  finnhub_ws: { provider: "finnhub", assets: ["stock", "crypto"], connection: "finnhub" },
  finnhub_ws_trade: { provider: "finnhub", assets: ["stock", "crypto"], connection: "finnhub" },
  finnhub_rest_quote: { provider: "finnhub", assets: ["stock"] },
  alpaca_latest_stock_quote: { provider: "alpaca", assets: ["stock"] },
  alpaca_crypto_latest: { provider: "alpaca", assets: ["crypto"] },
});

export function getLiveQuoteProvider(source = "") {
  return LIVE_QUOTE_SOURCE_REGISTRY[String(source || "").toLowerCase()]?.provider || null;
}

export function isLiveQuoteSource(source = "") {
  return getLiveQuoteProvider(source) !== null;
}

export function evaluateLiveQuoteProviderReadiness(
  source = "",
  {
    isCrypto = false,
    polygonConnected = false,
    finnhubConnected = false,
  } = {}
) {
  const quoteSource = String(source || "").toLowerCase();
  const registration = LIVE_QUOTE_SOURCE_REGISTRY[quoteSource] || null;
  const provider = registration?.provider || null;
  const assetClass = isCrypto === true ? "crypto" : "stock";
  const supportsAsset = registration?.assets?.includes(assetClass) === true;
  const connected = supportsAsset && (
    !registration?.connection ||
    (registration.connection === "polygon" && polygonConnected === true) ||
    (registration.connection === "finnhub" && finnhubConnected === true)
  );

  return {
    provider,
    connected,
    quoteSource: String(source || ""),
    reason: provider
      ? !supportsAsset
        ? `${provider.toUpperCase()}_LIVE_QUOTE_SOURCE_UNSUPPORTED_FOR_${assetClass.toUpperCase()}`
        : connected
        ? `${provider.toUpperCase()}_LIVE_QUOTE_PROVIDER_READY`
        : `${provider.toUpperCase()}_LIVE_QUOTE_PROVIDER_DISCONNECTED`
      : "UNRECOGNIZED_LIVE_QUOTE_PROVIDER",
  };
}

export function calculateSpread({ bid = 0, ask = 0, price = 0, previous = {} }) {
  const spreadAvailable = bid > 0 && ask >= bid && price > 0;
  const spread = spreadAvailable
    ? Number((ask - bid).toFixed(4))
    : null;
  const spreadPercent = spreadAvailable
    ? Number((((ask - bid) / ((ask + bid) / 2)) * 100).toFixed(4))
    : null;

  return { spread, spreadPercent, spreadAvailable };
}

function parsedTimestamp(value) {
  if (!value) return null;
  const timestamp = Number.isFinite(Number(value))
    ? Number(value)
    : Date.parse(String(value));
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function getLiveQuoteTimestampMs(quote = {}) {
  for (const value of [
    quote.liveQuoteUpdatedAt,
    quote.quoteFetchedAt,
    quote.updatedAt,
  ]) {
    const timestamp = parsedTimestamp(value);
    if (timestamp !== null) return timestamp;
  }
  return null;
}

export function hasNonRegressiveProviderTimestamp(previous = {}, incoming = {}) {
  const incomingTimestamp = getLiveQuoteTimestampMs(incoming);
  if (incomingTimestamp === null) return false;
  const previousTimestamp = getLiveQuoteTimestampMs(previous);
  return previousTimestamp === null || incomingTimestamp >= previousTimestamp;
}

export function getSpreadTimestamp(quote = {}) {
  return quote.spreadUpdatedAt || quote.bidAskUpdatedAt || null;
}

export function getSpreadAgeSeconds(quote = {}, now = Date.now()) {
  const timestamp = parsedTimestamp(getSpreadTimestamp(quote));
  if (timestamp === null) return null;
  return (Number(now) - timestamp) / 1000;
}

export function isFreshMeasuredSpread(
  quote = {},
  { maxAgeSeconds = 5, now = Date.now() } = {}
) {
  const bid = Number(quote.bid || quote.bp || 0);
  const ask = Number(quote.ask || quote.ap || 0);
  const ageSeconds = getSpreadAgeSeconds(quote, now);
  return (
    quote.spreadAvailable === true &&
    bid > 0 &&
    ask >= bid &&
    ageSeconds !== null &&
    ageSeconds >= -5 &&
    ageSeconds <= Number(maxAgeSeconds || 5)
  );
}

export function mergeLiveQuoteEvidence(
  previous = {},
  incoming = {},
  { price = 0, quoteUpdatedAt = null, quoteSource = "live_stream" } = {}
) {
  const incomingBid = Number(incoming.bid || incoming.bp || 0);
  const incomingAsk = Number(incoming.ask || incoming.ap || 0);
  const incomingHasSpread = incomingBid > 0 && incomingAsk >= incomingBid;
  const previousBid = Number(previous.bid || previous.bp || 0);
  const previousAsk = Number(previous.ask || previous.ap || 0);
  const previousHasSpread =
    previous.spreadAvailable === true &&
    previousBid > 0 &&
    previousAsk >= previousBid;
  const incomingSpreadUpdatedAt = incomingHasSpread
    ? getSpreadTimestamp(incoming) || quoteUpdatedAt
    : null;
  const incomingSpreadTimestampMs = parsedTimestamp(incomingSpreadUpdatedAt);
  const previousSpreadTimestampMs = parsedTimestamp(getSpreadTimestamp(previous));
  const incomingSpreadIsUsable =
    incomingHasSpread &&
    incomingSpreadTimestampMs !== null &&
    incomingSpreadTimestampMs <= Date.now() + 5000 &&
    (
      previousSpreadTimestampMs === null ||
      incomingSpreadTimestampMs >= previousSpreadTimestampMs
    );
  const bid = incomingSpreadIsUsable
    ? incomingBid
    : previousHasSpread
      ? previousBid
      : 0;
  const ask = incomingSpreadIsUsable
    ? incomingAsk
    : previousHasSpread
      ? previousAsk
      : 0;
  const spreadEvidence = calculateSpread({ bid, ask, price });
  const spreadUpdatedAt = incomingSpreadIsUsable
    ? incomingSpreadUpdatedAt
    : previousHasSpread
      ? getSpreadTimestamp(previous)
      : null;
  const spreadSource = incomingSpreadIsUsable
    ? incoming.spreadSource || quoteSource
    : previousHasSpread
      ? previous.spreadSource || previous.liveQuoteSource || previous.source || null
      : null;

  return {
    bid,
    ask,
    ...spreadEvidence,
    spreadUpdatedAt,
    bidAskUpdatedAt: spreadUpdatedAt,
    spreadSource,
    spreadPreservedFromPrevious: !incomingSpreadIsUsable && previousHasSpread,
  };
}

export function calculateLiveMovePercent(previousPrice = 0, price = 0) {
  return previousPrice > 0 && price > 0
    ? Number((((price - previousPrice) / previousPrice) * 100).toFixed(4))
    : 0;
}

export function isFreshLiveQuote(quote = {}, {
  maxAgeSeconds,
  isLiveQuoteSource,
} = {}) {
  const updatedAt =
    quote.liveQuoteUpdatedAt ||
    quote.quoteFetchedAt ||
    quote.updatedAt ||
    quote.timestamp ||
    null;

  if (!updatedAt) return false;

  const quoteTimestamp = new Date(updatedAt).getTime();
  const rawAgeSeconds = (Date.now() - quoteTimestamp) / 1000;
  if (!Number.isFinite(rawAgeSeconds) || rawAgeSeconds < -5) return false;
  const ageSeconds = Math.max(0, Math.round(rawAgeSeconds));

  const source =
    quote.liveQuoteSource ||
    quote.source ||
    "";

  return (
    ageSeconds <= Number(maxAgeSeconds || 15) &&
    isLiveQuoteSource(source)
  );
}

export function getAuthoritativeLiveQuote(symbol, {
  engineState,
  normalizeSymbol,
  maxAgeSeconds,
  isLiveQuoteSource,
} = {}) {
  const cleanSymbol = normalizeSymbol(symbol);
  const cached = engineState.liveQuoteCache?.[cleanSymbol] || null;

  if (!cached) return null;

  const price = Number(cached.price || cached.current || 0);
  if (!price || price <= 0) return null;

  const fresh = isFreshLiveQuote(cached, {
    maxAgeSeconds,
    isLiveQuoteSource,
  });

  if (!fresh) return null;

  return {
    ...cached,
    symbol: cleanSymbol,
    current: price,
    price,
    source: cached.liveQuoteSource || cached.source || "live_cache",
    liveQuoteSource: cached.liveQuoteSource || cached.source || "live_cache",
    priceIsLive: true,
    priceStale: false,
    quoteAuthorityRank: 1,
  };
}

export function getLiveQuoteAgeSeconds(symbol, {
  engineState,
  normalizeSymbol,
  getQuoteTimestampMs,
} = {}) {
  const cleanSymbol = normalizeSymbol(symbol);

  const quote =
    engineState.liveQuoteCache?.[cleanSymbol] ||
    engineState.liveMarketMemory?.[cleanSymbol];

  const updatedAt = getQuoteTimestampMs(quote);

  if (!updatedAt || !Number.isFinite(updatedAt)) {
    return Infinity;
  }

  return Math.floor((Date.now() - updatedAt) / 1000);
}

export function cleanupLiveQuoteCache({
  engineState,
  maxAgeMinutes,
  maxSymbols,
  maxSecondCandles,
} = {}) {
  engineState.liveQuoteCache ||= {};
  engineState.liveMarketMemory ||= {};

  const cutoffMs = Date.now() - Number(maxAgeMinutes || 10) * 60 * 1000;

  let quoteRemoved = 0;
  let memoryRemoved = 0;

  for (const [symbol, quote] of Object.entries(engineState.liveQuoteCache)) {
    const updatedAtMs = quote?.updatedAt
      ? new Date(quote.updatedAt).getTime()
      : 0;

    if (!updatedAtMs || updatedAtMs < cutoffMs) {
      delete engineState.liveQuoteCache[symbol];
      quoteRemoved += 1;
    }
  }

  for (const [symbol, memory] of Object.entries(engineState.liveMarketMemory)) {
    const updatedAtMs = memory?.updatedAt
      ? new Date(memory.updatedAt).getTime()
      : 0;

    if (!updatedAtMs || updatedAtMs < cutoffMs) {
      delete engineState.liveMarketMemory[symbol];
      memoryRemoved += 1;
      continue;
    }

    if (Array.isArray(memory.secondCandles)) {
      memory.secondCandles = memory.secondCandles.slice(
        -Math.min(Number(maxSecondCandles || 120), 60)
      );
    }

    if (Array.isArray(memory.tickWindow)) {
      memory.tickWindow = memory.tickWindow.slice(-50);
    }

    if (Array.isArray(memory.minuteCandles)) {
      memory.minuteCandles = memory.minuteCandles.slice(-30);
    }

    if (Array.isArray(memory.chartBars)) {
      memory.chartBars = memory.chartBars.slice(-60);
    }
  }

  const quoteEntries = Object.entries(engineState.liveQuoteCache);

  if (quoteEntries.length > Number(maxSymbols || 100)) {
    const keepQuotes = quoteEntries
      .sort(([, a], [, b]) => {
        return (
          new Date(b?.updatedAt || 0).getTime() -
          new Date(a?.updatedAt || 0).getTime()
        );
      })
      .slice(0, Number(maxSymbols || 100));

    engineState.liveQuoteCache = Object.fromEntries(keepQuotes);
    quoteRemoved += Math.max(0, quoteEntries.length - keepQuotes.length);
  }

  const memoryEntries = Object.entries(engineState.liveMarketMemory);

  if (memoryEntries.length > Number(maxSymbols || 100)) {
    const keep = memoryEntries
      .sort(([, a], [, b]) => {
        const scoreDiff =
          Number(b?.fastRunnerScore || 0) -
          Number(a?.fastRunnerScore || 0);

        if (scoreDiff !== 0) return scoreDiff;

        return (
          new Date(b?.updatedAt || 0).getTime() -
          new Date(a?.updatedAt || 0).getTime()
        );
      })
      .slice(0, Number(maxSymbols || 100));

    engineState.liveMarketMemory = Object.fromEntries(keep);
    memoryRemoved += Math.max(0, memoryEntries.length - keep.length);
  }

  engineState.liveMemoryCleanupState = {
    ok: true,
    cleanedAt: new Date().toISOString(),
    maxAgeMinutes,
    quoteRemoved,
    memoryRemoved,
    liveQuoteCount: Object.keys(engineState.liveQuoteCache).length,
    liveMemoryCount: Object.keys(engineState.liveMarketMemory).length,
  };

  return engineState.liveMemoryCleanupState;
}
