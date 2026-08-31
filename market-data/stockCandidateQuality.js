function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function timestampMs(value) {
  if (!value) return null;
  const parsed = Number.isFinite(Number(value))
    ? Number(value)
    : Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

export function evaluateStockCandidateQuoteQuality(
  candidate = {},
  quote = {},
  {
    now = Date.now(),
    maxQuoteAgeSeconds = 120,
    maxSpreadPercent = 2,
    minDollarVolume = 250_000,
  } = {}
) {
  const bid = finiteNumber(quote.bid ?? quote.bp) || 0;
  const ask = finiteNumber(quote.ask ?? quote.ap) || 0;
  const price =
    finiteNumber(quote.price ?? quote.current) ||
    (bid > 0 && ask >= bid ? (bid + ask) / 2 : 0);
  const providerTimestamp =
    quote.spreadUpdatedAt ||
    quote.bidAskUpdatedAt ||
    quote.liveQuoteUpdatedAt ||
    quote.quoteFetchedAt ||
    quote.updatedAt ||
    null;
  const providerTimestampMs = timestampMs(providerTimestamp);
  const quoteAgeSeconds = providerTimestampMs === null
    ? null
    : (Number(now) - providerTimestampMs) / 1000;
  const spreadAvailable = bid > 0 && ask >= bid;
  const spreadPercent = spreadAvailable
    ? ((ask - bid) / ((ask + bid) / 2)) * 100
    : null;
  const volume = Math.max(0, Number(candidate.volume || candidate.dayVolume || 0));
  const referencePrice = Math.max(
    0,
    Number(candidate.current || candidate.price || price || 0)
  );
  const dollarVolume = volume * referencePrice;
  const reasons = [];

  if (!spreadAvailable) reasons.push("TWO_SIDED_QUOTE_UNAVAILABLE");
  if (providerTimestampMs === null) reasons.push("QUOTE_TIMESTAMP_UNAVAILABLE");
  if (quoteAgeSeconds !== null && quoteAgeSeconds < -5) {
    reasons.push("QUOTE_TIMESTAMP_IN_FUTURE");
  }
  if (
    quoteAgeSeconds !== null &&
    quoteAgeSeconds > Number(maxQuoteAgeSeconds || 120)
  ) {
    reasons.push("QUOTE_TOO_STALE_FOR_WATCHLIST");
  }
  if (
    spreadPercent !== null &&
    spreadPercent > Number(maxSpreadPercent || 2)
  ) {
    reasons.push("SPREAD_TOO_WIDE_FOR_WATCHLIST");
  }
  if (dollarVolume < Number(minDollarVolume || 0)) {
    reasons.push("DOLLAR_VOLUME_TOO_LOW");
  }

  const moveMagnitude = Math.min(20, Math.abs(Number(candidate.percentChange || 0)));
  const liquidityScore = Math.min(35, Math.max(0, Math.log10(dollarVolume + 1) * 5));
  const spreadScore = spreadPercent === null
    ? 0
    : Math.max(0, 25 - spreadPercent * 12.5);
  const freshnessScore = quoteAgeSeconds === null
    ? 0
    : quoteAgeSeconds <= 5
      ? 20
      : quoteAgeSeconds <= 30
        ? 12
        : quoteAgeSeconds <= 60
          ? 6
          : 2;
  const qualityScore = Number(
    Math.max(0, Math.min(100,
      moveMagnitude + liquidityScore + spreadScore + freshnessScore
    )).toFixed(2)
  );

  return {
    accepted: reasons.length === 0,
    reasons,
    qualityScore,
    bid,
    ask,
    price,
    spreadAvailable,
    spreadPercent: spreadPercent === null
      ? null
      : Number(spreadPercent.toFixed(4)),
    quoteUpdatedAt: providerTimestamp,
    quoteAgeSeconds: quoteAgeSeconds === null
      ? null
      : Number(quoteAgeSeconds.toFixed(2)),
    volume,
    dollarVolume: Number(dollarVolume.toFixed(2)),
  };
}

export function filterAndRankStockCandidatesByExecutionQuality({
  candidates = [],
  quotes = [],
  normalizeSymbol = (value) => String(value || "").trim().toUpperCase(),
  ...options
} = {}) {
  const quoteBySymbol = new Map(
    (Array.isArray(quotes) ? quotes : [])
      .map((quote) => [normalizeSymbol(quote?.symbol), quote])
      .filter(([symbol]) => Boolean(symbol))
  );
  const reviewed = (Array.isArray(candidates) ? candidates : [])
    .map((candidate) => {
      const symbol = normalizeSymbol(candidate?.symbol);
      const quote = quoteBySymbol.get(symbol) || {};
      const executionQuoteQuality = evaluateStockCandidateQuoteQuality(
        candidate,
        quote,
        options
      );
      return {
        ...candidate,
        symbol,
        bid: executionQuoteQuality.bid || null,
        ask: executionQuoteQuality.ask || null,
        spreadAvailable: executionQuoteQuality.spreadAvailable,
        spreadPercent: executionQuoteQuality.spreadPercent,
        spreadUpdatedAt: executionQuoteQuality.quoteUpdatedAt,
        bidAskUpdatedAt: executionQuoteQuality.quoteUpdatedAt,
        spreadSource: executionQuoteQuality.spreadAvailable
          ? quote.spreadSource || quote.liveQuoteSource || quote.source || "execution_quote"
          : null,
        executionQuoteQuality,
        executionQualityScore: executionQuoteQuality.qualityScore,
      };
    });

  const accepted = reviewed
    .filter((candidate) => candidate.executionQuoteQuality.accepted)
    .sort((a, b) => {
      const qualityDifference =
        Number(b.executionQualityScore || 0) - Number(a.executionQualityScore || 0);
      if (qualityDifference !== 0) return qualityDifference;
      return Math.abs(Number(b.percentChange || 0)) - Math.abs(Number(a.percentChange || 0));
    });
  const rejected = reviewed.filter(
    (candidate) => candidate.executionQuoteQuality.accepted !== true
  );
  const rejectionCounts = rejected.reduce((counts, candidate) => {
    for (const reason of candidate.executionQuoteQuality.reasons) {
      counts[reason] = Number(counts[reason] || 0) + 1;
    }
    return counts;
  }, {});

  return {
    accepted,
    rejected,
    reviewedCount: reviewed.length,
    acceptedCount: accepted.length,
    rejectedCount: rejected.length,
    rejectionCounts,
  };
}
