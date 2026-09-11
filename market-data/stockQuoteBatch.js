import { getStockExecutionEvidenceFreshness } from "./stockQuoteEvidence.js";
import { selectStockExecutionQuote } from "./stockQuoteSelection.js";

export function createStockQuoteBatch({ primary, fallback, normalizeSymbol, now = Date.now, maxFallbackMs = 2000, onQuotes = () => {} }) {
  return async (symbols = []) => {
    const rows = await primary(symbols).catch(() => []);
    const fresh = rows.filter((q) => {
      const e = getStockExecutionEvidenceFreshness(q, { now: now() });
      return e.quoteFresh && e.spreadFresh;
    });
    const present = new Set(fresh.map((q) => normalizeSymbol(q.symbol)));
    onQuotes(fresh);
    const missing = symbols.filter((s) => !present.has(normalizeSymbol(s)));
    // Primary successes are published above. Give missing symbols their own
    // bounded fallback window, independent of the primary quote's age.
    const budget = Math.max(0, maxFallbackMs);
    let extra = [];
    if (missing.length && budget > 0) {
      const controller = new AbortController();
      let timer;
      try {
        extra = await Promise.race([
          Promise.resolve().then(() => fallback(missing, { signal: controller.signal, timeoutMs: Math.max(1, budget / 2) })).catch(() => []),
          new Promise((resolve) => { timer = setTimeout(() => { controller.abort(); resolve([]); }, budget); }),
        ]);
      } finally { clearTimeout(timer); controller.abort(); }
      onQuotes(extra);
    }
    const bySymbol = new Map(rows.map((q) => [normalizeSymbol(q.symbol), q]));
    for (const q of extra) {
      const key = normalizeSymbol(q.symbol);
      bySymbol.set(key, selectStockExecutionQuote(bySymbol.get(key), q, { now: now() }));
    }
    return [...bySymbol.values()].map((q) => {
      const e = getStockExecutionEvidenceFreshness(q, { now: now() });
      return { ...q, priceIsLive: e.quoteFresh, priceStale: !e.quoteFresh,
        // Measurement availability and freshness are different facts. Marking
        // an old observation "unavailable" can erase a newer stream BBO.
        spreadAvailable: q.spreadAvailable === true, spreadFresh: e.spreadFresh };
    });
  };
}
