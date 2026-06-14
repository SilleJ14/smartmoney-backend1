export function getAlpacaKeys(runtimeAlpacaKeys, runtimeConfig) {
  return {
    key:
      runtimeAlpacaKeys.liveKey ||
      runtimeConfig.alpacaLiveKey ||
      process.env.ALPACA_LIVE_KEY,

    secret:
      runtimeAlpacaKeys.liveSecret ||
      runtimeConfig.alpacaLiveSecret ||
      process.env.ALPACA_LIVE_SECRET,
  };
}

export function getTradingBaseUrl() {
  return "https://api.alpaca.markets";
}

export const ALPACA_DATA_BASE_URL =
  process.env.ALPACA_DATA_BASE_URL ||
  "https://data.alpaca.markets";