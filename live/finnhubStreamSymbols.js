const DEFAULT_FINNHUB_CRYPTO_EXCHANGE = "BINANCE";
const DEFAULT_FINNHUB_CRYPTO_QUOTE = "USDT";

function cleanToken(value = "") {
  return String(value || "").trim().toUpperCase();
}

export function isAppCryptoSymbol(symbol = "") {
  const clean = cleanToken(symbol).replace("-", "/");
  return /^[A-Z0-9]+\/(USD|USDT|USDC)$/.test(clean);
}

export function toFinnhubStreamSymbol(
  appSymbol = "",
  {
    exchange = DEFAULT_FINNHUB_CRYPTO_EXCHANGE,
    quoteCurrency = DEFAULT_FINNHUB_CRYPTO_QUOTE,
  } = {}
) {
  const clean = cleanToken(appSymbol).replace("-", "/");
  if (!clean) return "";
  if (!isAppCryptoSymbol(clean)) return clean;

  const [base] = clean.split("/");
  const cleanExchange = cleanToken(exchange) || DEFAULT_FINNHUB_CRYPTO_EXCHANGE;
  const cleanQuote = cleanToken(quoteCurrency) || DEFAULT_FINNHUB_CRYPTO_QUOTE;
  return `${cleanExchange}:${base}${cleanQuote}`;
}

export function fromFinnhubStreamSymbol(
  providerSymbol = "",
  {
    exchange = DEFAULT_FINNHUB_CRYPTO_EXCHANGE,
    quoteCurrency = DEFAULT_FINNHUB_CRYPTO_QUOTE,
  } = {}
) {
  const clean = cleanToken(providerSymbol);
  if (!clean) return "";
  if (!clean.includes(":")) return clean;

  const [providerExchange, pair = ""] = clean.split(":", 2);
  const cleanExchange = cleanToken(exchange) || DEFAULT_FINNHUB_CRYPTO_EXCHANGE;
  const cleanQuote = cleanToken(quoteCurrency) || DEFAULT_FINNHUB_CRYPTO_QUOTE;
  if (providerExchange !== cleanExchange || !pair.endsWith(cleanQuote)) return "";

  const base = pair.slice(0, -cleanQuote.length);
  return base ? `${base}/USD` : "";
}
