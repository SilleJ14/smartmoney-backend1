import { isLiveQuoteSource } from "../live/liveQuoteCache.js";

function finitePositive(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return null;
}

export function mergeLiveStockQuoteWithReference(
  liveQuote = null,
  referenceQuote = null
) {
  if (!liveQuote && !referenceQuote) return null;
  liveQuote ||= {};
  referenceQuote ||= {};

  const livePrice = finitePositive(
    liveQuote.current,
    liveQuote.price,
    liveQuote.lastTradePrice,
    liveQuote.c
  );
  const referencePrice = finitePositive(
    referenceQuote.current,
    referenceQuote.price,
    referenceQuote.c
  );
  const price = livePrice || referencePrice;
  const liveBid = finitePositive(liveQuote.bid, liveQuote.bp);
  const liveAsk = finitePositive(liveQuote.ask, liveQuote.ap);
  const liveSpreadMeasured = liveQuote.spreadAvailable !== false && liveBid !== null && liveAsk !== null && liveAsk >= liveBid;
  const referenceBid = finitePositive(referenceQuote.bid, referenceQuote.bp);
  const referenceAsk = finitePositive(referenceQuote.ask, referenceQuote.ap);
  const referenceSpreadMeasured =
    referenceQuote.spreadAvailable !== false && referenceBid !== null && referenceAsk !== null && referenceAsk >= referenceBid;
  const liveSpreadTime = Date.parse(liveQuote.spreadUpdatedAt || liveQuote.bidAskUpdatedAt || "");
  const referenceSpreadTime = Date.parse(referenceQuote.spreadUpdatedAt || referenceQuote.bidAskUpdatedAt || "");
  const useLiveSpread = liveSpreadMeasured && (!referenceSpreadMeasured ||
    !Number.isFinite(referenceSpreadTime) ||
    (Number.isFinite(liveSpreadTime) && liveSpreadTime >= referenceSpreadTime));
  const selectedSpread = useLiveSpread ? liveQuote : referenceSpreadMeasured ? referenceQuote : null;
  const bid = useLiveSpread ? liveBid : referenceSpreadMeasured ? referenceBid : null;
  const ask = useLiveSpread ? liveAsk : referenceSpreadMeasured ? referenceAsk : null;
  const volume = Math.max(
    0,
    Number(liveQuote.volume || liveQuote.v || 0),
    Number(referenceQuote.volume || referenceQuote.v || 0)
  );
  const previousClose = finitePositive(
    referenceQuote.previousClose,
    referenceQuote.pc,
    liveQuote.previousClose,
    liveQuote.pc
  );
  const open = finitePositive(
    referenceQuote.open,
    referenceQuote.o,
    liveQuote.open,
    liveQuote.o
  );
  const highValues = [
    liveQuote.high,
    liveQuote.h,
    referenceQuote.high,
    referenceQuote.h,
    price,
  ].map(Number).filter((value) => Number.isFinite(value) && value > 0);
  const lowValues = [
    liveQuote.low,
    liveQuote.l,
    referenceQuote.low,
    referenceQuote.l,
    price,
  ].map(Number).filter((value) => Number.isFinite(value) && value > 0);
  const high = highValues.length > 0 ? Math.max(...highValues) : null;
  const low = lowValues.length > 0 ? Math.min(...lowValues) : null;
  const measuredPercent = price !== null && previousClose !== null
    ? ((price - previousClose) / previousClose) * 100
    : null;

  return {
    ...referenceQuote,
    ...liveQuote,
    current: price,
    price,
    open,
    high,
    low,
    previousClose,
    volume,
    bid,
    ask,
    bp: bid,
    ap: ask,
    spread: bid !== null && ask !== null ? ask - bid : null,
    spreadPercent: bid !== null && ask !== null
      ? ((ask - bid) / ((ask + bid) / 2)) * 100
      : null,
    spreadAvailable: bid !== null && ask !== null,
    spreadUpdatedAt: selectedSpread?.spreadUpdatedAt || selectedSpread?.bidAskUpdatedAt || null,
    bidAskUpdatedAt: selectedSpread?.spreadUpdatedAt || selectedSpread?.bidAskUpdatedAt || null,
    spreadSource: selectedSpread?.spreadSource || selectedSpread?.liveQuoteSource || selectedSpread?.source || null,
    percentChange: measuredPercent,
    changePercent: measuredPercent,
    dayChangePercent: measuredPercent,
    percentChangeAvailable: measuredPercent !== null,
    changePercentAvailable: measuredPercent !== null,
    dayChangePercentAvailable: measuredPercent !== null,
    percentChangeReferencePrice: previousClose,
    changeReferencePrice: previousClose,
    percentChangeReferenceType:
      measuredPercent !== null ? "previous_close" : null,
    changeReferenceType:
      measuredPercent !== null ? "previous_close" : null,
    percentChangeSource:
      measuredPercent !== null ? "merged_live_price_previous_close" : null,
    changePercentSource:
      measuredPercent !== null ? "merged_live_price_previous_close" : null,
    referenceQuoteSource:
      referenceQuote.source || referenceQuote.liveQuoteSource || null,
    referenceQuoteUpdatedAt:
      referenceQuote.updatedAt || referenceQuote.quoteFetchedAt || null,
  };
}

export function getStockExecutionEvidenceFreshness(
  quote = {},
  { now = Date.now(), maxAgeSeconds = 5 } = {}
) {
  const maximumAgeMs = Math.min(
    5,
    Math.max(1, Number(maxAgeSeconds || 5))
  ) * 1000;
  const quoteTimestamp = Date.parse(
    quote.liveQuoteUpdatedAt || quote.quoteFetchedAt || quote.updatedAt || ""
  );
  const spreadTimestamp = Date.parse(
    quote.spreadUpdatedAt || quote.bidAskUpdatedAt || ""
  );
  const quoteAgeMs = Number.isFinite(quoteTimestamp)
    ? Number(now) - quoteTimestamp
    : null;
  const spreadAgeMs = Number.isFinite(spreadTimestamp)
    ? Number(now) - spreadTimestamp
    : null;
  const quoteSource = quote.liveQuoteSource || quote.source || "";
  const spreadSource = quote.spreadSource || "";
  const bid = finitePositive(quote.bid, quote.bp);
  const ask = finitePositive(quote.ask, quote.ap);
  const quoteFresh = quote.priceIsLive === true &&
    isLiveQuoteSource(quoteSource, "stock") &&
    quoteAgeMs !== null && quoteAgeMs >= -5_000 && quoteAgeMs <= maximumAgeMs;
  const spreadFresh = bid !== null && ask !== null && ask >= bid &&
    quote.spreadAvailable !== false &&
    isLiveQuoteSource(spreadSource, "stock") &&
    spreadAgeMs !== null && spreadAgeMs >= -5_000 && spreadAgeMs <= maximumAgeMs;
  return {
    quoteFresh,
    spreadFresh,
    quoteAgeSeconds: quoteAgeMs === null ? null : quoteAgeMs / 1000,
    spreadAgeSeconds: spreadAgeMs === null ? null : spreadAgeMs / 1000,
    maximumAgeSeconds: maximumAgeMs / 1000,
  };
}
