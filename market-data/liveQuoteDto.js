import { mergeLiveQuoteEvidence } from "../live/liveQuoteCache.js";

function finiteOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function availableValue(available, ...values) {
  if (!available) return null;
  for (const value of values) {
    const parsed = finiteOrNull(value);
    if (parsed !== null) return parsed;
  }
  return null;
}

export function buildCompactLiveQuoteDto(symbol, quote = {}, memory = {}) {
  const price = finiteOrNull(quote.price ?? quote.current);
  const pair = mergeLiveQuoteEvidence(memory, quote, { price, quoteSource: quote.liveQuoteSource || quote.source });
  const { bid, ask, spreadAvailable } = pair;
  const percentChangeAvailable =
    quote.displayPercentAvailable === true ||
    quote.todayPercentAvailable === true ||
    quote.livePercentChangeAvailable === true ||
    quote.percentChangeAvailable === true;
  const percentChange = availableValue(
    percentChangeAvailable,
    quote.displayPercent,
    quote.todayPercent,
    quote.livePercentChange,
    quote.percentChange
  );
  const todayPercentAvailable =
    quote.todayPercentAvailable === true || memory.todayPercentAvailable === true;
  const afterhoursPercentAvailable =
    quote.afterhoursPercentAvailable === true || memory.afterhoursPercentAvailable === true;
  const intradayPercentAvailable =
    quote.intradayPercentAvailable === true || memory.intradayPercentAvailable === true;
  const displayPercentAvailable =
    quote.displayPercentAvailable === true ||
    memory.displayPercentAvailable === true ||
    percentChangeAvailable;

  return {
    symbol,
    quoteVersion: Number(quote.quoteVersion || 0),
    price,
    current: price,
    livePrice: price,
    displayPrice: price,
    bid,
    ask,
    spread: availableValue(spreadAvailable, pair.spread),
    spreadPercent: availableValue(
      spreadAvailable,
      pair.spreadPercent
    ),
    spreadAvailable,
    spreadUpdatedAt:
      pair.spreadUpdatedAt,
    spreadSource: pair.spreadSource,
    previousClose: finiteOrNull(quote.previousClose ?? memory.previousClose),
    dayOpen: finiteOrNull(quote.dayOpen ?? memory.dayOpen),
    percentChange,
    percentChangeAvailable: percentChangeAvailable && percentChange !== null,
    percentChangeReferencePrice: finiteOrNull(
      quote.percentChangeReferencePrice ?? quote.changeReferencePrice
    ),
    percentChangeReferenceType:
      quote.percentChangeReferenceType || quote.changeReferenceType || null,
    percentChangeSource:
      quote.percentChangeSource || quote.changePercentSource || null,
    todayPercent: availableValue(
      todayPercentAvailable,
      quote.todayPercent,
      memory.todayPercent
    ),
    todayPercentAvailable,
    afterhoursPercent: availableValue(
      afterhoursPercentAvailable,
      quote.afterhoursPercent,
      memory.afterhoursPercent
    ),
    afterhoursPercentAvailable,
    intradayPercent: availableValue(
      intradayPercentAvailable,
      quote.intradayPercent,
      memory.intradayPercent
    ),
    intradayPercentAvailable,
    displayPercent: availableValue(
      displayPercentAvailable,
      quote.displayPercent,
      memory.displayPercent,
      percentChange
    ),
    displayPercentAvailable,
    displayPercentLabel:
      quote.displayPercentLabel || memory.displayPercentLabel || "Today",
    source: quote.source || "live_cache",
    liveQuoteSource: quote.liveQuoteSource || quote.source || "live_cache",
    liveQuoteUpdatedAt:
      quote.liveQuoteUpdatedAt || quote.updatedAt || null,
    spreadProviderUpdatedAt:
      pair.spreadUpdatedAt || null,
    priceIsLive: quote.priceIsLive === true,
    updatedAt: quote.updatedAt || null,
    previousPrice: finiteOrNull(quote.previousPrice),
    liveMoveFromPreviousPercent:
      finiteOrNull(quote.liveMoveFromPreviousPercent),
  };
}
