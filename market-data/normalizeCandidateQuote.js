// A quote's price, source, timestamp and spread evidence travel together.
// Receipt time is never a substitute for either provider timestamp.
export function normalizeCandidateQuote(signal = {}) {
  const time = value => value == null || value === '' ? NaN : typeof value === 'number' ? value : Date.parse(value);
  const flatTime = time(signal.liveQuoteUpdatedAt);
  const nested = signal.liveQuote;
  const nestedTime = time(nested?.updatedAt ?? nested?.liveQuoteUpdatedAt);
  if (nested && Number(nested.price ?? nested.current) > 0 && Number.isFinite(nestedTime) &&
    (!Number.isFinite(flatTime) || nestedTime > flatTime)) {
    const price = Number(nested.price ?? nested.current);
    return { ...signal, price, current: price, livePrice: price,
      liveQuote: { ...nested, updatedAt: new Date(nestedTime).toISOString() },
      liveQuoteUpdatedAt: new Date(nestedTime).toISOString(),
      liveQuoteSource: nested.liveQuoteSource || nested.source,
      priceIsLive: nested.priceIsLive === true,
      bid: nested.bid, ask: nested.ask, spreadAvailable: nested.spreadAvailable === true,
      spreadPercent: nested.spreadPercent, spreadSource: nested.spreadSource,
      spreadUpdatedAt: nested.spreadUpdatedAt || nested.bidAskUpdatedAt || null,
      bidAskUpdatedAt: nested.bidAskUpdatedAt || nested.spreadUpdatedAt || null };
  }
  if (!Number.isFinite(flatTime)) return signal;
  return { ...signal, liveQuote: { price: signal.price ?? signal.current,
    updatedAt: new Date(flatTime).toISOString(), source: signal.liveQuoteSource,
    priceIsLive: signal.priceIsLive === true, bid: signal.bid, ask: signal.ask,
    spreadPercent: signal.spreadPercent, spreadAvailable: signal.spreadAvailable === true,
    spreadUpdatedAt: signal.spreadUpdatedAt, bidAskUpdatedAt: signal.bidAskUpdatedAt, spreadSource: signal.spreadSource } };
}
