// Watch-only discovery. These gates do not authorize a buy.
export const WATCH_DISCOVERY_DEFAULTS = Object.freeze({
  maxCurrentMovePercent: 10,
  minAverageDollarVolume: 100000,
  minWatchShareVolume: 50000,
  earlyMoveMinPercent: 0.25,
  newsMaxAgeMs: 4 * 60 * 60 * 1000,
  newsSymbolLimit: 15,
  watchlistScore: 60,
});

export function passesWatchMoverActivity(item = {}, {
  marketOpen = true,
  minWatchShareVolume = WATCH_DISCOVERY_DEFAULTS.minWatchShareVolume,
  earlyMoveMinPercent = WATCH_DISCOVERY_DEFAULTS.earlyMoveMinPercent,
} = {}) {
  const percentChange = Math.abs(Number(item.percentChange || 0));
  const volume = Number(item.volume || 0);
  if (!Number.isFinite(volume) || volume < 0) return false;
  if (marketOpen !== true) {
    return percentChange >= 0.3 || volume >= 500;
  }
  const watchVolume = Math.max(0, Number(minWatchShareVolume) || WATCH_DISCOVERY_DEFAULTS.minWatchShareVolume);
  const earlyMove = Number.isFinite(Number(earlyMoveMinPercent))
    ? Number(earlyMoveMinPercent)
    : WATCH_DISCOVERY_DEFAULTS.earlyMoveMinPercent;
  return (
    (percentChange >= earlyMove && volume >= watchVolume) ||
    volume >= watchVolume * 6
  );
}

export function collectNewsWatchSymbols(articles = [], {
  now = Date.now(),
  limit = WATCH_DISCOVERY_DEFAULTS.newsSymbolLimit,
  maxAgeMs = WATCH_DISCOVERY_DEFAULTS.newsMaxAgeMs,
} = {}) {
  const seen = new Set();
  const symbols = [];
  for (const article of Array.isArray(articles) ? articles : []) {
    const publishedAt = Number(article?.publishedAt || article?.datetime || 0);
    if (Number.isFinite(publishedAt) && publishedAt > 0 && Number(now) - publishedAt > maxAgeMs) {
      continue;
    }
    const related = String(article?.related || article?.symbol || "")
      .split(",")
      .map((value) => String(value || "").trim().toUpperCase())
      .filter((value) => /^[A-Z][A-Z0-9.-]{0,9}$/.test(value) && value !== "MARKET" && value !== "CRYPTO");
    for (const symbol of related) {
      if (seen.has(symbol)) continue;
      seen.add(symbol);
      symbols.push(symbol);
      if (symbols.length >= limit) return symbols;
    }
  }
  return symbols;
}

export function isStockWatchlistEligible({
  finalScore,
  discoveryAvailable = false,
  watchlistScore = WATCH_DISCOVERY_DEFAULTS.watchlistScore,
} = {}) {
  if (discoveryAvailable === true) return true;
  const score = Number(finalScore);
  return Number.isFinite(score) && score >= Number(watchlistScore || 0);
}
