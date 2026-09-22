import { isFreshMeasuredSpread } from "./liveQuoteCache.js";

export const ALPACA_CRYPTO_EXECUTION_SOURCES = Object.freeze([
  "alpaca_crypto_ws",
  "alpaca_crypto_latest",
  "alpaca_crypto_orderbook",
]);

export const CRYPTO_REST_QUOTE_BATCH_SIZE = 24;
export const FALLBACK_ALPACA_CRYPTO_USD_PAIRS = Object.freeze([
  "BTC/USD",
  "ETH/USD",
  "SOL/USD",
  "XRP/USD",
  "DOGE/USD",
  "ADA/USD",
  "AVAX/USD",
  "LINK/USD",
  "LTC/USD",
  "DOT/USD",
  "UNI/USD",
  "AAVE/USD",
  "BCH/USD",
  "SHIB/USD",
  "PEPE/USD",
  "BONK/USD",
  "WIF/USD",
  "ARB/USD",
]);

export function resolveCryptoAssetUniverse({ fetched = [], cached = [] } = {}) {
  const live = (Array.isArray(fetched) ? fetched : []).map((symbol) => String(symbol || "").toUpperCase()).filter((symbol) => symbol.endsWith("/USD"));
  if (live.length) return live;
  const previous = (Array.isArray(cached) ? cached : []).map((symbol) => String(symbol || "").toUpperCase()).filter((symbol) => symbol.endsWith("/USD"));
  if (previous.length) return previous;
  return [...FALLBACK_ALPACA_CRYPTO_USD_PAIRS];
}

export function isAlpacaCryptoExecutionSource(source = "") {
  return ALPACA_CRYPTO_EXECUTION_SOURCES.includes(String(source || "").toLowerCase());
}

export function isTradeOnlyQuoteTick(quote = {}) {
  const source = String(quote.liveQuoteSource || quote.source || "").toLowerCase();
  return quote.eventType === "trade" || /(?:ws_trade|latest_trade)$/.test(source);
}

export function cryptoQuoteHasFreshAlpacaBook(quote = {}, {
  now = Date.now(),
  maxAgeSeconds = 5,
} = {}) {
  if (!quote || quote.spreadAvailable !== true) return false;
  const source = quote.spreadSource || quote.liveQuoteSource || quote.source;
  return isAlpacaCryptoExecutionSource(source)
    && isFreshMeasuredSpread(quote, { maxAgeSeconds, now });
}

export function applyTradeTickWithoutClearingAlpacaBook(previous = {}, incoming = {}) {
  const incomingSource = incoming.liveQuoteSource || incoming.source;
  if (
    isAlpacaCryptoExecutionSource(previous.liveQuoteSource || previous.spreadSource || previous.source) &&
    previous.spreadAvailable === true &&
    !isAlpacaCryptoExecutionSource(incomingSource)
  ) {
    incoming = { ...incoming, eventType: incoming.eventType || "trade" };
  }
  if (!isTradeOnlyQuoteTick(incoming)) return incoming;
  const previousSource = previous.liveQuoteSource || previous.spreadSource || previous.source;
  if (!isAlpacaCryptoExecutionSource(previousSource) || previous.spreadAvailable !== true) {
    return {
      ...incoming,
      spreadAvailable: false,
      eventType: incoming.eventType || "trade",
    };
  }
  return {
    ...incoming,
    eventType: "trade",
    spreadAvailable: true,
    bid: Number(previous.bid || previous.bp || 0),
    ask: Number(previous.ask || previous.ap || 0),
    bp: Number(previous.bp || previous.bid || 0),
    ap: Number(previous.ap || previous.ask || 0),
    spreadSource: previous.spreadSource || previous.liveQuoteSource || previous.source,
    spreadUpdatedAt: previous.spreadUpdatedAt || previous.bidAskUpdatedAt,
    bidAskUpdatedAt: previous.bidAskUpdatedAt || previous.spreadUpdatedAt,
    liveQuoteSource: previous.liveQuoteSource || previous.source,
    source: previous.source || previous.liveQuoteSource,
    liveQuoteUpdatedAt: previous.liveQuoteUpdatedAt,
    quoteFetchedAt: previous.quoteFetchedAt || previous.liveQuoteUpdatedAt,
    updatedAt: previous.updatedAt || previous.liveQuoteUpdatedAt,
    price: Number(previous.price || previous.current || incoming.price || 0),
    current: Number(previous.current || previous.price || incoming.price || 0),
    priceIsLive: previous.priceIsLive === true,
    lastTradePrice: Number(incoming.price || incoming.current || 0) || null,
    lastTradeUpdatedAt: incoming.liveQuoteUpdatedAt || incoming.quoteFetchedAt || incoming.updatedAt || null,
    lastTradeSource: incoming.liveQuoteSource || incoming.source || null,
  };
}

export function selectAlpacaCryptoStreamSymbols({
  symbols = [],
  quotes = {},
  scores = {},
  heldSymbols = [],
  pinnedSymbols = [],
  limit = 120,
  now = Date.now(),
  maxAgeSeconds = 5,
} = {}) {
  const held = new Set(
    (Array.isArray(heldSymbols) ? heldSymbols : [])
      .map((symbol) => String(symbol || "").toUpperCase())
      .filter((symbol) => /^[A-Z0-9]+\/USD$/.test(symbol))
  );
  const unique = [...new Set(
    (Array.isArray(symbols) ? symbols : [])
      .map((symbol) => String(symbol || "").toUpperCase())
      .filter((symbol) => /^[A-Z0-9]+\/USD$/.test(symbol))
  )];
  const ranked = [...unique].sort((left, right) => {
    const heldGap = Number(held.has(right)) - Number(held.has(left));
    if (heldGap) return heldGap;
    const leftNeedsBook = cryptoQuoteHasFreshAlpacaBook(quotes[left], { now, maxAgeSeconds }) ? 0 : 1;
    const rightNeedsBook = cryptoQuoteHasFreshAlpacaBook(quotes[right], { now, maxAgeSeconds }) ? 0 : 1;
    if (rightNeedsBook !== leftNeedsBook) return rightNeedsBook - leftNeedsBook;
    const scoreGap = Number(scores[right] || 0) - Number(scores[left] || 0);
    if (scoreGap) return scoreGap;
    return left.localeCompare(right);
  });
  const cap = Math.max(1, Number(limit) || 120);
  const pinned = [...new Set(
    (Array.isArray(pinnedSymbols) ? pinnedSymbols : [])
      .map((symbol) => String(symbol || "").toUpperCase())
      .filter((symbol) => unique.includes(symbol))
  )];
  const selected = [];
  const seen = new Set();
  const add = (symbol) => {
    if (!symbol || seen.has(symbol) || selected.length >= cap) return;
    seen.add(symbol);
    selected.push(symbol);
  };
  // Held names and the current socket set stay put. Ranking only fills empty
  // slots so a stale book does not unsubscribe a live coin every few seconds.
  for (const symbol of unique.filter((symbol) => held.has(symbol))) add(symbol);
  for (const symbol of pinned) add(symbol);
  for (const symbol of ranked) add(symbol);
  return selected;
}

export function selectCryptoRestQuoteBatch({
  symbols = [],
  streamSymbols = [],
  quotes = {},
  batchSize = CRYPTO_REST_QUOTE_BATCH_SIZE,
  cursor = 0,
  now = Date.now(),
  maxAgeSeconds = 5,
  streamConnected = true,
} = {}) {
  const needRest = (Array.isArray(symbols) ? symbols : [])
    .map((symbol) => String(symbol || "").toUpperCase())
    .filter((symbol) => /^[A-Z0-9]+\/USD$/.test(symbol))
    .filter((symbol, index, rows) => rows.indexOf(symbol) === index)
    .filter((symbol) => !cryptoQuoteHasFreshAlpacaBook(quotes[symbol], { now, maxAgeSeconds }));
  const size = Math.max(1, Number(batchSize) || CRYPTO_REST_QUOTE_BATCH_SIZE);
  if (!needRest.length) return { symbols: [], nextCursor: 0 };
  const start = ((Number(cursor) || 0) % needRest.length + needRest.length) % needRest.length;
  const selected = [];
  for (let offset = 0; offset < Math.min(size, needRest.length); offset += 1) {
    selected.push(needRest[(start + offset) % needRest.length]);
  }
  return {
    symbols: selected,
    nextCursor: (start + selected.length) % needRest.length,
  };
}
