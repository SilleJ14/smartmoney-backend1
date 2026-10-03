import { createStockQuoteBatch } from "./stockQuoteBatch.js";
import { createStockHistory } from "./stockHistory.js";

// US stock data policy, kept in one place so the order is testable:
//   1. Tradier: consolidated, primary for quotes and bars.
//   2. Polygon/Massive: consolidated. A quote counts as real-time only when its
//      own provider timestamps prove it.
//   3. Alpaca IEX: one exchange only. It is the last resort, used for display
//      and analysis, and cannot authorize a buy.
// server.js passes the providers by role, so the order cannot be changed there
// by accident.
export const STOCK_QUOTE_ROUTE = Object.freeze(["tradier", "polygon", "alpaca_iex"]);
export const STOCK_BAR_ROUTE = Object.freeze(["tradier", "polygon", "alpaca"]);

function addCounts(target, counts) {
  for (const [name, count] of Object.entries(counts || {})) {
    if (Number.isFinite(count)) target[name] = (target[name] || 0) + count;
  }
}

export function createStockQuoteRouting({ tradier, polygon = null, alpacaIex = null, normalizeSymbol,
  now = Date.now, maxFallbackMs = 3000, onQuotes = () => {}, onServed = () => {}, fallbackForStale = () => true } = {}) {
  if (typeof tradier?.getLatestQuotes !== "function") throw new Error("Tradier quote source required");
  const totals = { batches: 0, requested: 0, servedBy: {}, fallbackRequested: {} };
  let last = null;
  const stages = {
    polygon: typeof polygon?.getLatestQuotes === "function"
      ? { name: "polygon", fetch: (symbols, options) => polygon.getLatestQuotes(symbols, options) } : null,
    alpaca_iex: typeof alpacaIex === "function" ? { name: "alpaca_iex", fetch: alpacaIex } : null,
  };
  const fallbacks = STOCK_QUOTE_ROUTE.slice(1).map((name) => stages[name]).filter(Boolean);
  const collect = createStockQuoteBatch({
    primary: (symbols) => tradier.getLatestQuotes(symbols),
    primaryName: STOCK_QUOTE_ROUTE[0],
    fallbacks,
    maxFallbackMs,
    normalizeSymbol,
    now,
    fallbackForStale,
    onQuotes,
    onServed: (summary) => {
      last = summary;
      totals.batches += 1;
      totals.requested += Number(summary.requested) || 0;
      addCounts(totals.servedBy, summary.servedBy);
      addCounts(totals.fallbackRequested, summary.fallbackRequested);
      onServed(summary);
    },
  });
  return {
    collect,
    getStatus: () => ({
      order: [STOCK_QUOTE_ROUTE[0], ...fallbacks.map((stage) => stage.name)],
      last,
      totals: { ...totals, servedBy: { ...totals.servedBy }, fallbackRequested: { ...totals.fallbackRequested } },
    }),
  };
}

// Bars: Tradier history (only when Tradier is configured; sandbox history is
// labelled delayed), then Polygon aggregates, then Alpaca IEX. createStockHistory
// keeps each result to exactly one provider.
export function createStockHistoryRouting({ tradierMarketData = null, polygon = null, alpaca = null, ...options } = {}) {
  const tradierReady = tradierMarketData?.configured === true && typeof tradierMarketData.getHistory === "function";
  return createStockHistory({
    ...options,
    tradier: tradierReady ? tradierMarketData.getHistory : null,
    tradierDelayed: tradierReady && tradierMarketData.sandbox === true,
    polygon,
    alpaca,
  });
}
