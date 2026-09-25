import { stockFeedProvenance } from "./feedContract.js";

// Provider sizes are not all shares. Convert only where the source documents the unit.
// Tradier REST bidsize/asksize are hundreds of shares.
// Tradier stream bidsz/asksz is documented only as "bid size", so it stays raw.
// Alpaca stock sizes are shares after 2025-11-03 and were round lots before that.
// Alpaca crypto sizes are base-asset units. Trade and timesale sizes are shares.

export const ALPACA_STOCK_SHARE_SIZE_AT = Date.parse("2025-11-03T00:00:00.000Z");

function finiteNonNegative(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function text(value) {
  const clean = String(value ?? "").trim();
  return clean ? clean : null;
}

export function sharesFromSize(raw, unit) {
  const size = finiteNonNegative(raw);
  if (size === null) return { raw: null, shares: null, unit: unit || "unknown" };
  if (unit === "shares" || unit === "base_units") return { raw: size, shares: size, unit };
  if (unit === "hundreds" || unit === "round_lots") return { raw: size, shares: size * 100, unit };
  return { raw: size, shares: null, unit: unit || "unknown" };
}

export function alpacaStockSizeUnit(quoteTimestamp) {
  const at = quoteTimestamp === null || quoteTimestamp === undefined || quoteTimestamp === ""
    ? Date.now()
    : Date.parse(quoteTimestamp);
  return Number.isFinite(at) && at < ALPACA_STOCK_SHARE_SIZE_AT ? "round_lots" : "shares";
}

export function quoteBookFromParts({
  bidPrice = null,
  askPrice = null,
  bidSize = null,
  askSize = null,
  bidExchange = null,
  askExchange = null,
  quoteTimestamp = null,
  lastTradePrice = null,
  lastTradeSize = null,
  lastTradeTimestamp = null,
  lastTradeBid = null,
  lastTradeAsk = null,
  provider = null,
  feed = null,
  tapeFeed = null,
  sizeUnit = "unknown",
  tradeSizeUnit = "shares",
} = {}) {
  const bid = sharesFromSize(bidSize, sizeUnit);
  const ask = sharesFromSize(askSize, sizeUnit);
  const trade = sharesFromSize(lastTradeSize, tradeSizeUnit);
  return {
    bidPrice: finiteNonNegative(bidPrice),
    askPrice: finiteNonNegative(askPrice),
    bidSizeRaw: bid.raw,
    askSizeRaw: ask.raw,
    bidSizeShares: bid.shares,
    askSizeShares: ask.shares,
    sizeUnit: bid.unit,
    bidExchange: text(bidExchange),
    askExchange: text(askExchange),
    quoteTimestamp: text(quoteTimestamp),
    lastTradePrice: finiteNonNegative(lastTradePrice),
    lastTradeSizeRaw: trade.raw,
    lastTradeSize: trade.shares,
    lastTradeTimestamp: text(lastTradeTimestamp),
    lastTradeBid: finiteNonNegative(lastTradeBid),
    lastTradeAsk: finiteNonNegative(lastTradeAsk),
    provider: text(provider),
    feed: text(feed),
    provenance: stockFeedProvenance({
      provider,
      feed: tapeFeed || feed,
      measuredAt: quoteTimestamp,
    }),
  };
}

export function normalizeTradierRestBook(raw = {}, quoteTimestamp = null) {
  return quoteBookFromParts({
    bidPrice: raw.bid,
    askPrice: raw.ask,
    bidSize: raw.bidsize,
    askSize: raw.asksize,
    bidExchange: raw.bidexch,
    askExchange: raw.askexch,
    quoteTimestamp,
    lastTradePrice: raw.last,
    lastTradeSize: raw.last_volume,
    lastTradeTimestamp: raw.trade_date ? new Date(Number(raw.trade_date)).toISOString() : null,
    provider: "TRADIER",
    feed: "rest_quote",
    tapeFeed: "CONSOLIDATED",
    sizeUnit: "hundreds",
    tradeSizeUnit: "shares",
  });
}

export function normalizeTradierStreamBook(raw = {}, quoteTimestamp = null) {
  return quoteBookFromParts({
    bidPrice: raw.bid,
    askPrice: raw.ask,
    bidSize: raw.bidsz ?? raw.bidsize,
    askSize: raw.asksz ?? raw.asksize,
    bidExchange: raw.bidexch,
    askExchange: raw.askexch,
    quoteTimestamp,
    provider: "TRADIER",
    feed: "stream_quote",
    tapeFeed: "CONSOLIDATED",
    sizeUnit: "unknown",
  });
}

export function normalizeTradierPrint(raw = {}) {
  const last = raw.last ?? raw.price;
  const at = raw.date || raw.trade_date;
  const stamp = at === null || at === undefined || at === ""
    ? null
    : new Date(Number(at) < 1e10 ? Number(at) * 1000 : Number(at)).toISOString();
  return quoteBookFromParts({
    lastTradePrice: last,
    lastTradeSize: raw.size ?? raw.last_volume,
    lastTradeTimestamp: Number.isFinite(Date.parse(stamp || "")) ? stamp : null,
    lastTradeBid: raw.bid,
    lastTradeAsk: raw.ask,
    provider: "TRADIER",
    feed: raw.type === "timesale" ? "timesale" : "trade",
    tapeFeed: "CONSOLIDATED",
    tradeSizeUnit: "shares",
  });
}

export function normalizeAlpacaStockBook(raw = {}, quoteTimestamp = null) {
  return quoteBookFromParts({
    bidPrice: raw.bp ?? raw.bid,
    askPrice: raw.ap ?? raw.ask,
    bidSize: raw.bs ?? raw.bidSize,
    askSize: raw.as ?? raw.askSize,
    bidExchange: raw.bx ?? raw.bidExchange,
    askExchange: raw.ax ?? raw.askExchange,
    quoteTimestamp,
    provider: "ALPACA",
    feed: raw.feed || "stock_quote",
    tapeFeed: raw.feed || null,
    sizeUnit: alpacaStockSizeUnit(quoteTimestamp),
  });
}

export function normalizeAlpacaCryptoBook(raw = {}, quoteTimestamp = null) {
  return quoteBookFromParts({
    bidPrice: raw.bp ?? raw.bid,
    askPrice: raw.ap ?? raw.ask,
    bidSize: raw.bs ?? raw.bidSize,
    askSize: raw.as ?? raw.askSize,
    quoteTimestamp,
    provider: "alpaca",
    feed: raw.feed || "crypto_quote",
    sizeUnit: "base_units",
  });
}
