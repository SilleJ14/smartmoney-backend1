import {
  getCanonicalFinalScore,
  hasExplicitTradeApproval,
} from "../scoring/canonicalSignalRank.js";

export function getEnabledStrategyModes(effectiveMode) {
  return {
    stockModeEnabled: effectiveMode === "live_stock" || effectiveMode === "smart",
    cryptoModeEnabled: true,
  };
}

export function selectSmartTradingMode({ selectedMode, currentEffectiveMode, stockSignals = [], cryptoSignals = [] }) {
  if (selectedMode !== "smart") return currentEffectiveMode;
  const bestApprovedScore = (signals) => signals
    .filter(hasExplicitTradeApproval)
    .reduce((best, signal) => {
      const score = getCanonicalFinalScore(signal);
      return score === null ? best : Math.max(best, score);
    }, 0);
  const stockScore = bestApprovedScore(stockSignals);
  const cryptoScore = bestApprovedScore(cryptoSignals);
  if (stockScore === 0 && cryptoScore === 0) {
    return currentEffectiveMode || "live_stock";
  }
  return stockScore >= cryptoScore
    ? "live_stock"
    : "live_crypto";
}

export function buildStrategyExecutionPlan({
  selectedMode,
  effectiveMode,
  marketOpen,
  approvedStockCount,
  approvedCryptoCount,
  tradingStoppedForDay,
  stockTradingStoppedForDay,
  cryptoTradingStoppedForDay,
}) {
  const stockEnabled = effectiveMode === "live_stock" || selectedMode === "smart";
  return {
    shouldRunStockAutoBuy: Boolean(
      marketOpen && stockEnabled && approvedStockCount > 0 &&
      !tradingStoppedForDay && !stockTradingStoppedForDay
    ),
    shouldRunCryptoAutoBuy: Boolean(!cryptoTradingStoppedForDay),
  };
}
