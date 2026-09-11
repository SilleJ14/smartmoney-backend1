const LIVE_QUOTE_SOURCE_REGISTRY = Object.freeze({
  tradier_stock_quote: { provider: "tradier", assets: ["stock"] },
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

export function isLiveQuoteSource(source = "", assetClass = null) {
  const registration = LIVE_QUOTE_SOURCE_REGISTRY[String(source || "").toLowerCase()];
  return Boolean(registration && (!assetClass || registration.assets.includes(assetClass)));
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
  const incomingHasSpread = incoming.spreadAvailable !== false && incomingBid > 0 && incomingAsk >= incomingBid;
  const previousSpreadAt = parsedTimestamp(getSpreadTimestamp(previous));
  const incomingEvidenceAt = parsedTimestamp(getSpreadTimestamp(incoming)) ?? getLiveQuoteTimestampMs(incoming);
  const rejectsCurrentSpread = incoming.spreadAvailable === false &&
    (incomingEvidenceAt === null || previousSpreadAt === null || incomingEvidenceAt >= previousSpreadAt);
  const previousBid = Number(previous.bid || previous.bp || 0);
  const previousAsk = Number(previous.ask || previous.ap || 0);
  const previousHasSpread =
    !rejectsCurrentSpread &&
    previous.spreadAvailable === true &&
    parsedTimestamp(getSpreadTimestamp(previous)) !== null &&
    parsedTimestamp(getSpreadTimestamp(previous)) <= Date.now() + 5000 &&
    previousBid > 0 &&
    previousAsk >= previousBid;
  const incomingSpreadUpdatedAt = incomingHasSpread
    ? getSpreadTimestamp(incoming)
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

function firstFiniteNumber(record = {}, fields = []) {
  for (const field of fields) {
    const value = record?.[field];
    if (value === null || value === undefined || value === "") continue;
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return { field, value: parsed };
  }
  return null;
}

function firstPositiveNumber(record = {}, fields = []) {
  for (const field of fields) {
    const value = record?.[field];
    if (value === null || value === undefined || value === "") continue;
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return { field, value: parsed };
  }
  return null;
}

const PERCENT_CHANGE_FIELDS = Object.freeze([
  "percentChange",
  "changePercent",
  "dayChangePercent",
  "sessionChangePercent",
  "percentChange24h",
  "change24hPercent",
  "livePercentChange",
]);

const PERCENT_CHANGE_AVAILABILITY_FIELDS = Object.freeze([
  "percentChangeAvailable",
  "changePercentAvailable",
  "dayChangePercentAvailable",
  "sessionChangePercentAvailable",
  "percentChange24hAvailable",
  "change24hPercentAvailable",
  "livePercentChangeAvailable",
]);

const PERCENT_CHANGE_REFERENCE_FIELDS = Object.freeze([
  "percentChangeReferencePrice",
  "changeReferencePrice",
  "sessionReferencePrice",
  "previousClose",
  "pc",
  "regularMarketPreviousClose",
]);

/**
 * Resolve a percent-change observation without confusing unavailable data with
 * a real 0% move. A positive reference price is authoritative; otherwise an
 * explicit availability flag is required for zero to be considered measured.
 * Legacy non-zero observations remain readable during rolling deployments.
 */
export function resolveMeasuredPercentChange(quote = {}, { price } = {}) {
  const currentMatch = firstPositiveNumber(
    { suppliedPrice: price, ...quote },
    ["suppliedPrice", "price", "current", "livePrice", "last", "close", "c"]
  );
  const referenceMatch = firstPositiveNumber(
    quote,
    PERCENT_CHANGE_REFERENCE_FIELDS
  );
  if (currentMatch && referenceMatch) {
    const value = Number(
      (((currentMatch.value - referenceMatch.value) / referenceMatch.value) * 100)
        .toFixed(4)
    );
    return {
      available: true,
      value,
      referencePrice: referenceMatch.value,
      referenceField: referenceMatch.field,
      referenceType:
        quote.percentChangeReferenceType ||
        quote.changeReferenceType ||
        (referenceMatch.field === "previousClose" ||
        referenceMatch.field === "pc" ||
        referenceMatch.field === "regularMarketPreviousClose"
          ? "previous_close"
          : "measured_reference"),
      source:
        quote.percentChangeSource ||
        quote.changePercentSource ||
        quote.liveQuoteSource ||
        quote.source ||
        "reference_price",
    };
  }

  for (let index = 0; index < PERCENT_CHANGE_FIELDS.length; index += 1) {
    const percentField = PERCENT_CHANGE_FIELDS[index];
    const availabilityField = PERCENT_CHANGE_AVAILABILITY_FIELDS[index];
    const percentMatch = firstFiniteNumber(quote, [percentField]);
    if (!percentMatch) continue;
    const explicitAvailability = quote?.[availabilityField];
    const isLegacyMeasured =
      explicitAvailability === undefined && percentMatch.value !== 0;
    if (explicitAvailability !== true && !isLegacyMeasured) continue;
    const semanticReferenceType = percentField === "sessionChangePercent"
      ? "session_measured_percent"
      : percentField === "percentChange24h" || percentField === "change24hPercent"
        ? "rolling_24h_measured_percent"
        : "provider_measured_percent";
    return {
      available: true,
      value: Number(percentMatch.value.toFixed(4)),
      referencePrice: null,
      referenceField: null,
      referenceType:
        quote.percentChangeReferenceType ||
        quote.changeReferenceType ||
        (isLegacyMeasured ? "legacy_measured_percent" : semanticReferenceType),
      source:
        quote.percentChangeSource ||
        quote.changePercentSource ||
        quote.liveQuoteSource ||
        quote.source ||
        (isLegacyMeasured ? "legacy_percent" : "explicit_percent"),
    };
  }

  return {
    available: false,
    value: null,
    referencePrice: null,
    referenceField: null,
    referenceType: null,
    source: null,
  };
}

export function mergeMeasuredPercentChange(
  previous = {},
  incoming = {},
  { price } = {}
) {
  const incomingMeasurement = resolveMeasuredPercentChange(incoming, { price });
  if (incomingMeasurement.available) return incomingMeasurement;

  const previousMeasurement = resolveMeasuredPercentChange(previous, { price });
  return previousMeasurement.available
    ? previousMeasurement
    : incomingMeasurement;
}

export function buildMeasuredPercentChangePatch(
  signal = {},
  incoming = {},
  { price } = {}
) {
  const measurement = resolveMeasuredPercentChange(incoming, { price });
  if (!measurement.available) return {};
  const dayChangeAvailable = incoming.dayChangePercentAvailable === true || [
    "previous_completed_utc_daily_close",
    "current_utc_day_open",
    "previous_close",
  ].includes(measurement.referenceType);
  return {
    percentChange: measurement.value,
    changePercent: measurement.value,
    livePercentChange: measurement.value,
    percentChangeAvailable: true,
    changePercentAvailable: true,
    livePercentChangeAvailable: true,
    percentChangeReferencePrice: measurement.referencePrice,
    changeReferencePrice: measurement.referencePrice,
    percentChangeReferenceType: measurement.referenceType,
    changeReferenceType: measurement.referenceType,
    percentChangeSource: measurement.source,
    changePercentSource: measurement.source,
    ...(dayChangeAvailable
      ? {
        dayChangePercent: measurement.value,
        dayChangePercentAvailable: true,
        dayChangePercentSource: measurement.source,
      }
      : {}),
  };
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

  return (Date.now() - updatedAt) / 1000;
}

export function cleanupLiveQuoteCache({
  engineState,
  maxAgeMinutes,
  maxSymbols,
  maxSecondCandles,
  pinnedSymbols = [],
} = {}) {
  engineState.liveQuoteCache ||= {};
  engineState.liveMarketMemory ||= {};

  const cutoffMs = Date.now() - Number(maxAgeMinutes || 10) * 60 * 1000;

  let quoteRemoved = 0;
  let memoryRemoved = 0;
  const pinned = new Set(pinnedSymbols);

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
      .sort(([sa, a], [sb, b]) => {
        const pinGap = Number(pinned.has(sb)) - Number(pinned.has(sa));
        if (pinGap) return pinGap;
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
      .sort(([sa, a], [sb, b]) => {
        const pinGap = Number(pinned.has(sb)) - Number(pinned.has(sa));
        if (pinGap) return pinGap;
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
