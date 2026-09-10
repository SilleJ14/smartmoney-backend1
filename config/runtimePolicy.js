export function sanitizeRuntimeConfig(config = {}) {
  const safe = { ...config };
  if (safe.minStockPrice !== undefined) {
    const minimum = Number(safe.minStockPrice);
    safe.minStockPrice = Number.isFinite(minimum) ? Math.max(0.5, minimum) : 0.5;
  }
  if (safe.minScoreToBuy !== undefined) {
    safe.minScoreToBuy = Math.max(70, Number(safe.minScoreToBuy || 70));
  }
  return safe;
}

export function getEffectiveTradingMode(selectedMode) {
  const mode = String(selectedMode || "live_stock");
  if (mode === "smart" || mode === "live_crypto" || mode === "live_stock") return mode;
  return "live_stock";
}

export function resolveAutoTradingEnabled(config = {}, environmentValue) {
  if (typeof config.autoTradingEnabled === "boolean") {
    return config.autoTradingEnabled;
  }
  if (environmentValue !== undefined) {
    return String(environmentValue).trim().toLowerCase() === "true";
  }
  return false;
}
