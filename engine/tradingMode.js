export function createTradingMode({
  runtimeConfig = {},
  env = process.env,
} = {}) {
  let TRADING_MODE =
    runtimeConfig.tradingMode ||
    env.TRADING_MODE ||
    "live_stock";

  let tradingModeLocked =
    runtimeConfig.tradingModeLocked ?? false;

  function getEffectiveTradingMode(marketOpen) {
    const selectedMode = String(TRADING_MODE || "live_stock");

    if (selectedMode === "smart") return "smart";
    if (selectedMode === "live_crypto") return "live_crypto";
    if (selectedMode === "live_stock") return "live_stock";

    return "live_stock";
  }

  function getTradingMode() {
    return TRADING_MODE;
  }

  function setTradingMode(mode) {
    TRADING_MODE = mode || "live_stock";
    return TRADING_MODE;
  }

  function isTradingModeLocked() {
    return tradingModeLocked;
  }

  function setTradingModeLocked(value) {
    tradingModeLocked = Boolean(value);
    return tradingModeLocked;
  }

  return {
    getEffectiveTradingMode,
    getTradingMode,
    setTradingMode,
    isTradingModeLocked,
    setTradingModeLocked,
  };
}