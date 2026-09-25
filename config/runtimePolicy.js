import { parseFiniteNumber } from "./parseFiniteNumber.js";

export function sanitizeRuntimeConfig(config = {}) {
  const safe = { ...config };
  if (safe.minStockPrice !== undefined) {
    const minimum = Number(safe.minStockPrice);
    safe.minStockPrice = Number.isFinite(minimum) ? Math.max(0.5, minimum) : 0.5;
  }
  if (safe.maxStockPrice !== undefined) {
    const floor = Number.isFinite(Number(safe.minStockPrice)) ? Number(safe.minStockPrice) : 0.5;
    const maximum = Number(safe.maxStockPrice);
    safe.maxStockPrice = Number.isFinite(maximum)
      ? Math.min(10000, Math.max(floor, maximum))
      : Math.max(floor, 50);
  }
  if (safe.minScoreToBuy !== undefined) {
    const preference = parseFiniteNumber(safe.minScoreToBuy, 70);
    safe.automationMinimumPreference = preference;
    safe.minScoreToBuy = Math.max(70, preference);
  }
  if (safe.minScanVolume !== undefined) {
    safe.minScanVolume = Math.max(0, parseFiniteNumber(safe.minScanVolume, 300000));
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
  if (environmentValue !== undefined && String(environmentValue).trim() !== "") {
    return String(environmentValue).trim().toLowerCase() === "true";
  }
  return true;
}

export function resolveForexAutoEnabled(config = {}, environmentValue) {
  if (config.forexDailyLossLocked === true || config.forexEmergencyStopActive === true) return false;
  if (typeof config.forexAutoEnabled === "boolean") {
    return config.forexAutoEnabled;
  }
  if (environmentValue !== undefined) {
    return String(environmentValue).trim().toLowerCase() === "true";
  }
  return false;
}
