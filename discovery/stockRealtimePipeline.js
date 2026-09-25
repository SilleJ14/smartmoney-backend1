// Broad universe comes from historical and reference data.
// Tradier real-time quotes rank who is worth watching.
// Deep D/E/F runs on the priority queue, not on a fixed short list.
// A delayed Massive price never satisfies an execution quote.

export const STOCK_PIPELINE_CAPACITY = Object.freeze({
  quoteSweepBatch: 120,
  priorityVisible: 200,
  streamCapacity: 120,
  minimumDwellMs: 60 * 1000,
});

const EQUITY = new Set(["us_equity", "stock", "equity", "etf"]);

function symbolOf(value) {
  return String(value?.symbol || value || "").trim().toUpperCase();
}

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function filterStaticUniverse(rows = []) {
  const symbols = [];
  const rejections = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const symbol = symbolOf(row);
    if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol)) {
      rejections.push({ symbol: symbol || null, reason: "INVALID_SYMBOL" });
      continue;
    }
    if (row?.tradable === false || String(row?.status || "").toLowerCase() === "inactive") {
      rejections.push({ symbol, reason: "NOT_TRADABLE" });
      continue;
    }
    const assetClass = String(row?.assetClass || row?.class || "").toLowerCase();
    if (assetClass && !EQUITY.has(assetClass)) {
      rejections.push({ symbol, reason: "NOT_EQUITY" });
      continue;
    }
    const referencePrice = finite(row?.previousClose);
    if (referencePrice !== null && (referencePrice < 0.5 || referencePrice > 500)) {
      rejections.push({ symbol, reason: "PRICE_FILTER" });
      continue;
    }
    const baselineVolume = finite(row?.averageVolume ?? row?.historicalAverageVolume);
    if (baselineVolume !== null && baselineVolume < 50000) {
      rejections.push({ symbol, reason: "VOLUME_FILTER" });
      continue;
    }
    symbols.push(symbol);
  }
  return {
    broadUniverseCount: Array.isArray(rows) ? rows.length : 0,
    staticFilterPassedCount: symbols.length,
    symbols,
    rejections,
  };
}

export function rotateSweep(symbols = [], cursor = 0, size = STOCK_PIPELINE_CAPACITY.quoteSweepBatch) {
  const list = [...new Set(symbols.map(symbolOf).filter(Boolean))];
  if (!list.length) return { symbols: [], nextCursor: 0 };
  const start = ((Number(cursor) || 0) % list.length + list.length) % list.length;
  const count = Math.min(Math.max(1, Number(size) || list.length), list.length);
  const selected = [];
  for (let index = 0; index < count; index += 1) selected.push(list[(start + index) % list.length]);
  return { symbols: selected, nextCursor: (start + count) % list.length };
}

function quoteIsTradier(quote = {}) {
  const source = String(quote.liveQuoteSource || quote.source || quote.provider || "").toUpperCase();
  return source.includes("TRADIER");
}

function quoteIsDelayed(quote = {}) {
  const feed = String(quote.feed || quote.timing || "").toUpperCase();
  const provider = String(quote.provider || "").toUpperCase();
  return quote.delayed === true || quote.timing === "DELAYED" || feed === "DELAYED" || provider === "MASSIVE" || provider === "POLYGON";
}

export function rankTradierSweep(quotes = [], { volumeBaselines = {} } = {}) {
  const ranked = [];
  const rejections = [];
  for (const quote of Array.isArray(quotes) ? quotes : []) {
    const symbol = symbolOf(quote);
    if (!symbol) continue;
    if (quoteIsDelayed(quote) || !quoteIsTradier(quote)) {
      rejections.push({ symbol, reason: quoteIsDelayed(quote) ? "DELAYED_FEED" : "NO_TRADIER_QUOTE" });
      continue;
    }
    const price = finite(quote.price ?? quote.current ?? quote.last);
    if (price === null) {
      rejections.push({ symbol, reason: "NO_TRADIER_QUOTE" });
      continue;
    }
    const bid = quote.spreadAvailable === true ? finite(quote.bid) : finite(quote.bid);
    const ask = quote.spreadAvailable === true ? finite(quote.ask) : finite(quote.ask);
    const spread = finite(quote.spreadPercent);
    if (spread !== null && spread > 2) {
      rejections.push({ symbol, reason: "SPREAD_TOO_WIDE_FOR_DISCOVERY" });
      continue;
    }
    const baseline = volumeBaselines[symbol];
    const volumeComparable = !baseline || !baseline.volumeScope || !quote.volumeScope || baseline.volumeScope === quote.volumeScope;
    const move = Math.abs(finite(quote.percentChange) || 0);
    const volume = finite(quote.volume);
    const cheapMoveScore = Number((Math.min(40, move * 5) + (volumeComparable && volume ? Math.min(20, Math.log10(volume) * 4) : 0)).toFixed(2));
    ranked.push({
      symbol,
      price,
      current: price,
      displayPrice: price,
      percentChange: finite(quote.percentChange),
      percentChangeAvailable: quote.percentChangeAvailable === true,
      changePercentMeasured: quote.percentChangeAvailable === true,
      dayChangePercent: finite(quote.percentChange),
      previousClose: finite(quote.previousClose),
      bid: bid !== null && bid > 0 ? bid : null,
      ask: ask !== null && ask > 0 ? ask : null,
      bidSizeShares: finite(quote.bidSizeShares),
      askSizeShares: finite(quote.askSizeShares),
      volume: volumeComparable ? volume : null,
      volumeComparable,
      cheapMoveScore,
      provider: "TRADIER",
      feed: "REALTIME_CONSOLIDATED",
      liveQuoteSource: quote.liveQuoteSource || quote.source || "tradier_stock_quote",
      liveQuoteUpdatedAt: quote.liveQuoteUpdatedAt || null,
      priceIsLive: quote.priceIsLive === true,
      candidateSource: "TRADIER_QUOTE_SWEEP",
      qualifiedToBuy: false,
      assetClass: "stock",
    });
  }
  ranked.sort((left, right) => right.cheapMoveScore - left.cheapMoveScore || left.symbol.localeCompare(right.symbol));
  return {
    ranked,
    movers: ranked.map((row) => ({
      symbol: row.symbol,
      percentChange: row.percentChange,
      volume: row.volume,
      price: row.price,
    })),
    display: ranked.slice(0, STOCK_PIPELINE_CAPACITY.priorityVisible),
    rejections,
  };
}

export function executionQuoteDecision({
  provider = null,
  feed = null,
  timing = null,
  ageMs = null,
  spreadPercent = null,
} = {}) {
  const name = String(provider || "").toUpperCase();
  const tape = String(feed || "").toUpperCase();
  const delayed = timing === "DELAYED" || tape === "DELAYED" || name === "MASSIVE" || name === "POLYGON";
  if (delayed) {
    return { state: "WAIT", reason: "DELAYED_FEED", satisfiesExecution: false, changesFinalScore: false, marketDataQuality: "DELAYED" };
  }
  if (!name) {
    return { state: "DATA_UNAVAILABLE", reason: "QUOTE_UNAVAILABLE", satisfiesExecution: false, changesFinalScore: false, marketDataQuality: null };
  }
  if (name === "ALPACA" && (tape === "IEX" || tape === "ALPACA_IEX" || tape === "IEX_ONLY")) {
    return {
      state: "WAIT",
      reason: "CONSOLIDATED_QUOTE_UNAVAILABLE",
      satisfiesExecution: false,
      changesFinalScore: false,
      marketDataQuality: "SINGLE_EXCHANGE",
      feed: "ALPACA_IEX",
    };
  }
  if (ageMs === null || ageMs === undefined || !Number.isFinite(Number(ageMs))) {
    return { state: "DATA_UNAVAILABLE", reason: "MEASURED_AT_MISSING", satisfiesExecution: false, changesFinalScore: false };
  }
  if (Number(ageMs) > 5000) {
    return { state: "WAIT", reason: "QUOTE_STALE", satisfiesExecution: false, changesFinalScore: false };
  }
  if (spreadPercent !== null && spreadPercent !== undefined && Number(spreadPercent) > 1) {
    return { state: "EXECUTION_NOT_READY", reason: "SPREAD_TOO_WIDE", satisfiesExecution: false, changesFinalScore: false };
  }
  return {
    state: "PASS",
    reason: null,
    satisfiesExecution: true,
    changesFinalScore: false,
    provider: "TRADIER",
    feed: "REALTIME_CONSOLIDATED",
  };
}

export function newsPromotion(event = {}) {
  if (event.providerAvailable === false) return { promote: false, newsState: "NEWS_PROVIDER_UNAVAILABLE" };
  if (event.covered === false) return { promote: false, newsState: "NEWS_NOT_COVERED" };
  if (!event.headline) return { promote: false, newsState: "NO_CATALYST" };
  if (event.negative === true) return { promote: true, newsState: "NEGATIVE_CATALYST", symbol: symbolOf(event) };
  return { promote: true, newsState: "POSITIVE_CATALYST", symbol: symbolOf(event) };
}

export function countReasons(rows = []) {
  const counts = {};
  for (const row of rows) {
    const reason = row?.reason || "UNKNOWN";
    counts[reason] = (counts[reason] || 0) + 1;
  }
  return counts;
}

export function buildStockDiscoveryFunnel({
  broadUniverseCount = 0,
  staticFilterPassedCount = 0,
  sweepRequested = 0,
  tradierQuotes = 0,
  cheapCandidates = 0,
  streamingSymbols = 0,
  queueDepth = 0,
  deepScored = 0,
  rejections = [],
} = {}) {
  return {
    broadUniverse: broadUniverseCount,
    staticFilterPassed: staticFilterPassedCount,
    tradierQuoteSweepRequested: sweepRequested,
    tradierQuoteSweep: tradierQuotes,
    cheapRealtimeCandidates: cheapCandidates,
    tradierLiveSet: streamingSymbols,
    priorityQueue: queueDepth,
    deepScored,
    rejections: countReasons(rejections),
    fixedShortlist: false,
  };
}

export function mergeSweepWithDeepScores(sweepRows = [], deepRows = []) {
  const deep = new Map();
  for (const row of deepRows) {
    const symbol = symbolOf(row);
    if (symbol) deep.set(symbol, row);
  }
  const seen = new Set();
  const merged = [];
  for (const row of sweepRows) {
    const symbol = symbolOf(row);
    if (!symbol || seen.has(symbol)) continue;
    seen.add(symbol);
    merged.push(deep.get(symbol) || row);
  }
  for (const row of deepRows) {
    const symbol = symbolOf(row);
    if (!symbol || seen.has(symbol)) continue;
    seen.add(symbol);
    merged.push(row);
  }
  return merged;
}
