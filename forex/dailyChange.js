// Display-only evidence. Never used to authorize an order.
export function forexDailyChange(response, quote) {
  const unavailable = (reason) => ({ sessionChangePercent: null, dayChangePercent: null,
    changePercentMeasured: false, percentChangeEvidence: { measured: false, reason } });
  const quoteTime = Date.parse(quote?.time);
  const price = Number(quote?.mid);
  if (!Number.isFinite(quoteTime) || !(price > 0) || !Number.isFinite(price)) return unavailable("QUOTE_UNAVAILABLE");
  if (!Array.isArray(response?.candles)) return unavailable("DAILY_CANDLES_UNAVAILABLE");
  const completed = response.candles.filter(c => c?.complete === true &&
    Number.isFinite(Date.parse(c.time)) && Date.parse(c.time) < quoteTime)
    .sort((a, b) => Date.parse(b.time) - Date.parse(a.time));
  const candle = completed[0];
  const close = Number(candle?.mid?.c);
  if (!candle || !(close > 0) || !Number.isFinite(close)) return unavailable("DAILY_CLOSE_UNAVAILABLE");
  // Permit the weekend gap, but never label arbitrary old history as today's change.
  if (quoteTime - Date.parse(candle.time) > 4 * 86400000) return unavailable("DAILY_CLOSE_TOO_OLD");
  const change = (price / close - 1) * 100;
  return { sessionChangePercent: change, dayChangePercent: change, changePercentMeasured: true,
    percentChangeEvidence: { measured: true, basis: "PREVIOUS_COMPLETED_OANDA_DAILY_CLOSE",
      baselinePrice: close, baselineCandleAt: candle.time, priceAt: quote.time,
      dailyAlignment: 17, alignmentTimezone: "America/New_York" } };
}
