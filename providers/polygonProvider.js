function fallbackIsNormalStockSymbol(symbol = "") {
  const clean = String(symbol || "").trim().toUpperCase();

  if (!clean) return false;
  if (clean.includes(".")) return false;
  if (clean.includes("-")) return false;
  if (clean.includes("/")) return false;
  if (clean.length > 5) return false;

  return /^[A-Z]+$/.test(clean);
}

function getStockSymbolValidator(isNormalStockSymbol) {
  return typeof isNormalStockSymbol === "function"
    ? isNormalStockSymbol
    : fallbackIsNormalStockSymbol;
}

export function createEmptyPolygonMoversCache(reason = "") {
  return {
    at: 0,
    symbols: [],
    gainers: [],
    losers: [],
    moverDetails: {},
    reason,
  };
}

export function updatePolygonMoversCache({
  symbols = [],
  gainers = [],
  losers = [],
  ranked = [],
  reason = "",
  normalizeSymbol,
}) {
  return {
    at: Date.now(),
    symbols,
    gainers,
    losers,
    moverDetails: Object.fromEntries(
      ranked
        .filter((item) => item.symbol)
        .map((item) => [normalizeSymbol(item.symbol), item])
    ),
    reason,
  };
}

export function parsePolygonSnapshotTickers({
  tickers = [],
  normalizeSymbol,
  isNormalStockSymbol,
}) {
  const validateStockSymbol =
    getStockSymbolValidator(isNormalStockSymbol);

  return tickers
    .map((ticker) => {
      const symbol = normalizeSymbol(ticker?.ticker);

      const current = Number(
        ticker?.lastTrade?.p ||
        ticker?.day?.c ||
        0
      );

      const rawPercentChange = Number(
        ticker?.todaysChangePerc || 0
      );

      const previousClose = Number(
        ticker?.prevDay?.c ||
        (
          current > 0 && rawPercentChange !== 0
            ? current / (1 + rawPercentChange / 100)
            : 0
        )
      );

      const percentChange =
        Number.isFinite(rawPercentChange) && rawPercentChange !== 0
          ? rawPercentChange
          : previousClose > 0 && current > 0
            ? ((current - previousClose) / previousClose) * 100
            : 0;

      const volume = Number(ticker?.day?.v || 0);

      return {
        symbol,
        current,
        price: current,
        previousClose,
        dayOpen: Number(
          ticker?.day?.o || previousClose || 0
        ),
        percentChange,
        volume,
        direction:
          percentChange > 0
            ? "GAINER"
            : percentChange < 0
              ? "LOSER"
              : "FLAT",
      };
    })
    .filter((item) => validateStockSymbol(item.symbol))
    .filter((item) =>
      Number.isFinite(item.percentChange)
    );
}

export function rankPolygonMovers({
  rankedRaw = [],
  limit = 100,
}) {
  const gainers = rankedRaw
    .filter((item) => item.percentChange > 0)
    .sort((a, b) => b.percentChange - a.percentChange)
    .slice(0, limit);

  const losers = rankedRaw
    .filter((item) => item.percentChange < 0)
    .sort((a, b) => a.percentChange - b.percentChange)
    .slice(
      0,
      Math.max(10, Math.floor(limit * 0.25))
    );

  const ranked = [...gainers, ...losers].slice(0, limit);

  return {
    gainers,
    losers,
    ranked,
  };
}

export function buildNormalizedSymbolList({
  items = [],
  normalizeSymbol,
  isNormalStockSymbol,
}) {
  const validateStockSymbol =
    getStockSymbolValidator(isNormalStockSymbol);

  return items
    .map((item) => item.symbol)
    .filter(Boolean)
    .map(normalizeSymbol)
    .filter(validateStockSymbol);
}

export function buildPolygonFallbackSymbols({
  engineState,
  normalizeSymbol,
  isNormalStockSymbol,
}) {
  const validateStockSymbol =
    getStockSymbolValidator(isNormalStockSymbol);

  const preMoverFallbackSymbols = [
    ...(engineState.preMoverDiscoveryState?.topCandidates || []).map(
      (s) => s.symbol || s
    ),
    ...Object.values(
      engineState.preMoverDiscoveryMemory || {}
    ).map((s) => s.symbol || s),
  ]
    .filter(Boolean)
    .map(normalizeSymbol)
    .filter(validateStockSymbol);

  const runnerFallbackSymbols = [
    ...(engineState.fastRunnerCandidates || []).map(
      (s) => s.symbol
    ),
    ...(engineState.quickInstitutionalCandidates || []).map(
      (s) => s.symbol
    ),
    ...(engineState.institutionalWatchlist || []).map(
      (s) => s.symbol || s
    ),
    ...(engineState.lastStockSignals || []).map(
      (s) => s.symbol
    ),
    ...(engineState.topStockSignals || []).map(
      (s) => s.symbol
    ),
  ]
    .filter(Boolean)
    .map(normalizeSymbol)
    .filter(validateStockSymbol);

  return {
    preMoverFallbackSymbols,
    runnerFallbackSymbols,
  };
}