export function normalizeSymbol(symbol) {
  return String(symbol || "").trim().toUpperCase();
}