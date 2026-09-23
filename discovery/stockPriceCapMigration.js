import { MIN_STOCK_PRICE } from "./candidateFeedPolicy.js";

// Keep startup migrations independent of unpublished presentation-policy changes.
export function migrateStockPriceCapPreference(config = {}) {
  if (Number(config.stockPriceCapPolicyVersion || 0) >= 2) return config;
  const existing = Number(config.maxStockPrice);
  return {
    ...config,
    maxStockPrice: Number.isFinite(existing) && existing >= MIN_STOCK_PRICE ? existing : 50,
    stockPriceCapPolicyVersion: 2,
  };
}
