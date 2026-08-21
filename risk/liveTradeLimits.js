const normalize = (value) => String(value || "").trim().toUpperCase();

export function normalizeHoldCategory(value) {
  const normalized = String(value || "").trim().toLowerCase().replace(/[-\s]+/g, "_");
  return ["multi_day", "swing", "overnight"].includes(normalized) ? "multi_day" : "intraday";
}

export function ensureLiveTradeLimitDay(state, dateKey) {
  const current = state && typeof state === "object" ? state : {};
  if (current.dateKey === dateKey) return current;
  return {
    dateKey,
    intradayStockEntriesToday: 0,
    positionIntents: current.positionIntents && typeof current.positionIntents === "object" ? current.positionIntents : {},
  };
}

export function evaluateLiveTradeLimits({
  symbol,
  isCrypto = false,
  holdCategory = "intraday",
  positions = [],
  positionIntents = {},
  intradayStockEntriesToday = 0,
  limits = {},
} = {}) {
  const cleanSymbol = normalize(symbol);
  const existingSymbols = new Set(positions.map((position) => normalize(position.symbol)));
  const intentEnteredAt = Date.parse(positionIntents[cleanSymbol]?.enteredAt || "");
  const hasRecentEntryReservation = Number.isFinite(intentEnteredAt) && Date.now() - intentEnteredAt < 10 * 60 * 1000;
  const isExistingPosition = existingSymbols.has(cleanSymbol) || hasRecentEntryReservation;
  const maxIntradayStockTradesPerDay = Number(limits.maxIntradayStockTradesPerDay || 2);
  const maxIntradayStockPositions = Number(limits.maxIntradayStockPositions || 2);
  const maxMultiDayStockPositions = Number(limits.maxMultiDayStockPositions || 3);
  const maxCryptoOpenPositions = Number(limits.maxCryptoOpenPositions || 3);
  const stockPositions = positions.filter((position) => !position.isCrypto);
  const cryptoPositions = positions.filter((position) => position.isCrypto);
  const intradayStockPositions = stockPositions.filter((position) =>
    normalizeHoldCategory(positionIntents[normalize(position.symbol)]?.holdCategory) === "intraday"
  );
  const multiDayStockPositions = stockPositions.filter((position) =>
    normalizeHoldCategory(positionIntents[normalize(position.symbol)]?.holdCategory || "multi_day") === "multi_day"
  );
  const category = isCrypto ? "crypto" : normalizeHoldCategory(holdCategory);
  const reasons = [];

  if (!isExistingPosition) {
    if (category === "crypto" && cryptoPositions.length >= maxCryptoOpenPositions) {
      reasons.push(`Maximum open crypto positions reached (${maxCryptoOpenPositions})`);
    }
    if (category === "intraday") {
      if (intradayStockEntriesToday >= maxIntradayStockTradesPerDay) {
        reasons.push(`Maximum intraday stock trades reached for today (${maxIntradayStockTradesPerDay})`);
      }
      if (intradayStockPositions.length >= maxIntradayStockPositions) {
        reasons.push(`Maximum open intraday stock positions reached (${maxIntradayStockPositions})`);
      }
    }
    if (category === "multi_day" && multiDayStockPositions.length >= maxMultiDayStockPositions) {
      reasons.push(`Maximum open multi-day stock positions reached (${maxMultiDayStockPositions})`);
    }
  }

  return {
    approved: reasons.length === 0,
    reasons,
    category,
    isExistingPosition,
    counts: {
      intradayStockEntriesToday,
      intradayStockPositions: intradayStockPositions.length,
      multiDayStockPositions: multiDayStockPositions.length,
      cryptoPositions: cryptoPositions.length,
    },
    limits: { maxIntradayStockTradesPerDay, maxIntradayStockPositions, maxMultiDayStockPositions, maxCryptoOpenPositions },
  };
}

export function recordSuccessfulEntry(state = {}, { symbol, category, dateKey, isExistingPosition = false } = {}) {
  const cleanSymbol = normalize(symbol);
  if (!state.positionIntents || typeof state.positionIntents !== "object") state.positionIntents = {};
  if (!isExistingPosition) {
    state.positionIntents[cleanSymbol] = { holdCategory: category, enteredAt: new Date().toISOString() };
    if (category === "intraday") state.intradayStockEntriesToday = Number(state.intradayStockEntriesToday || 0) + 1;
  }
  state.dateKey = dateKey;
  return { recorded: !isExistingPosition, state };
}
