export function getEnabledStrategyModes(effectiveMode) {
  return {
    stockModeEnabled: effectiveMode === "live_stock" || effectiveMode === "smart",
    cryptoModeEnabled: effectiveMode === "live_crypto" || effectiveMode === "smart",
  };
}

export function selectSmartTradingMode({ selectedMode, currentEffectiveMode, stockSignals = [], cryptoSignals = [] }) {
  if (selectedMode !== "smart") return currentEffectiveMode;
  const bestApprovedScore = (signals, crypto = false) => signals
    .filter((signal) => signal.qualifiedToBuy === true &&
      (crypto ? signal.autoTradeApproved !== false : signal.autoTradeApproved === true))
    .reduce((best, signal) => Math.max(best, Number(signal.score || 0)), 0);
  return bestApprovedScore(stockSignals) >= bestApprovedScore(cryptoSignals, true)
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
  const cryptoEnabled = effectiveMode === "live_crypto" || selectedMode === "smart";
  return {
    shouldRunStockAutoBuy: Boolean(
      marketOpen && stockEnabled && approvedStockCount > 0 &&
      !tradingStoppedForDay && !stockTradingStoppedForDay
    ),
    shouldRunCryptoAutoBuy: Boolean(
      cryptoEnabled && approvedCryptoCount > 0 &&
      !cryptoTradingStoppedForDay
    ),
  };
}
