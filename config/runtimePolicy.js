export function sanitizeRuntimeConfig(config = {}) {
  const safe = { ...config };
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
  if (environmentValue !== undefined) {
    return String(environmentValue).trim().toLowerCase() === "true";
  }
  return config.autoTradingEnabled ?? false;
}
