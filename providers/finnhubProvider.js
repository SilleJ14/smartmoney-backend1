const FINNHUB_QUOTE_COOLDOWN_KEY = "finnhubQuote";

export function isFinnhubInCooldown(engineState) {
  const until = Number(engineState.apiCooldowns?.[FINNHUB_QUOTE_COOLDOWN_KEY] || 0);
  return until > Date.now();
}

export function putFinnhubInCooldown(engineState, minutes = 15) {
  engineState.apiCooldowns ||= {};
  engineState.apiFailureCounts ||= {};

  engineState.apiCooldowns[FINNHUB_QUOTE_COOLDOWN_KEY] =
    Date.now() + minutes * 60 * 1000;

  engineState.apiFailureCounts[FINNHUB_QUOTE_COOLDOWN_KEY] =
    Number(engineState.apiFailureCounts[FINNHUB_QUOTE_COOLDOWN_KEY] || 0) + 1;
}

export async function finnhubQuote({
  symbol,
  apiKey,
  engineState,
  fetchWithTimeout,
  normalizeSymbol,
}) {
  if (!apiKey) return null;
  if (isFinnhubInCooldown(engineState)) return null;

  const cleanSymbol = normalizeSymbol(symbol);

  const url =
    `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(cleanSymbol)}` +
    `&token=${apiKey}`;

  const response = await fetchWithTimeout(url);

  if (response.status === 429) {
    putFinnhubInCooldown(engineState, 15);
    return null;
  }

  if (!response.ok) {
    throw new Error(`Finnhub quote HTTP ${response.status}`);
  }

  const data = await response.json();

  const current = Number(data.c || 0);
  const previousClose = Number(data.pc || 0);
  const providerTimestampValue = Number(data.t || 0);
  const providerTimestampMs = providerTimestampValue > 0
    ? providerTimestampValue < 1e12
      ? providerTimestampValue * 1000
      : providerTimestampValue
    : NaN;
  const providerTimestamp = Number.isFinite(providerTimestampMs)
    ? new Date(providerTimestampMs).toISOString()
    : null;

  if (!current || current <= 0 || !providerTimestamp) return null;

  return {
    symbol: cleanSymbol,
    current,
    price: current,
    c: current,

    high: Number(data.h || current),
    h: Number(data.h || current),

    low: Number(data.l || current),
    l: Number(data.l || current),

    open: Number(data.o || current),
    o: Number(data.o || current),

    previousClose,
    pc: previousClose,

    change: current - previousClose,
    percentChange:
      previousClose > 0
        ? ((current - previousClose) / previousClose) * 100
        : 0,

    source: "finnhub_rest_quote",
    liveQuoteSource: "finnhub_rest_quote",
    liveQuoteUpdatedAt: providerTimestamp,
    quoteFetchedAt: providerTimestamp,
    priceIsLive: true,
    fetchedAt: new Date().toISOString(),
  };
}
