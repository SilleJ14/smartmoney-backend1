export function isCryptoSymbol(symbol = "") {
  const normalized = String(symbol || "")
    .trim()
    .toUpperCase();

  return (
    normalized.includes("/") ||
    normalized.endsWith("USD") ||
    normalized.includes("USDT")
  );
}

export function isValidStockTicker(symbol = "", normalizeSymbol) {
  const clean = normalizeSymbol(symbol);

  if (!clean) return false;
  if (isCryptoSymbol(clean)) return false;
  if (clean.includes("/")) return false;
  if (clean.includes("-")) return false;
  if (clean.includes(".")) return false;
  if (clean.length < 1 || clean.length > 5) return false;
  if (clean.length === 5 && /[YF]$/.test(clean)) return false;

  return /^[A-Z]+$/.test(clean);
}

export function normalizeCryptoSymbolForPolygon(symbol = "", normalizeSymbol) {
  const clean = normalizeSymbol(symbol)
    .replace(/^X:/, "")
    .replace("/", "-")
    .replace("_", "-");

  if (!clean) return "";

  if (clean.includes("-")) return clean;

  if (clean.endsWith("USDT") && clean.length > 4) {
    return `${clean.slice(0, -4)}-USDT`;
  }

  if (clean.endsWith("USD") && clean.length > 3) {
    return `${clean.slice(0, -3)}-USD`;
  }

  return clean;
}

export function normalizePolygonCryptoPairToAppSymbol(pair = "", normalizeSymbol) {
  const clean = normalizeSymbol(pair)
    .replace(/^X:/, "")
    .replace("_", "-");

  if (!clean) return "";

  if (clean.includes("-")) {
    const [base, quote] = clean.split("-");
    return base && quote ? `${base}/${quote}` : clean;
  }

  if (clean.endsWith("USDT") && clean.length > 4) {
    return `${clean.slice(0, -4)}/USDT`;
  }

  if (clean.endsWith("USD") && clean.length > 3) {
    return `${clean.slice(0, -3)}/USD`;
  }

  return clean;
}