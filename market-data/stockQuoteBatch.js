import { getStockExecutionEvidenceFreshness } from "./stockQuoteEvidence.js";
import { selectStockExecutionQuote } from "./stockQuoteSelection.js";

function stageList(fallbacks, fallback) {
  const list = Array.isArray(fallbacks) ? fallbacks : fallback ? [fallback] : [];
  return list.map((stage, index) => typeof stage === "function"
    ? { name: `fallback${index + 1}`, fetch: stage }
    : stage && typeof stage.fetch === "function" ? { name: String(stage.name || `fallback${index + 1}`), fetch: stage.fetch } : null)
    .filter(Boolean);
}

async function runStage(stage, symbols, windowMs) {
  const controller = new AbortController();
  let timer;
  try {
    const rows = await Promise.race([
      Promise.resolve().then(() => stage.fetch(symbols, { signal: controller.signal, timeoutMs: Math.max(1, windowMs / 2) })).catch(() => []),
      new Promise((resolve) => { timer = setTimeout(() => { controller.abort(); resolve([]); }, windowMs); }),
    ]);
    return Array.isArray(rows) ? rows : [];
  } finally { clearTimeout(timer); controller.abort(); }
}

// Primary first; each fallback stage only sees symbols still lacking a fresh
// quote+spread pair, in order, inside ONE bounded fallback budget.
// When `fallbackForStale()` is false (stock market closed), every quote is old by
// definition and no fallback can be fresher, so fallbacks only cover symbols the
// primary returned nothing for.
export function createStockQuoteBatch({ primary, fallback, fallbacks = null, normalizeSymbol, now = Date.now,
  maxFallbackMs = 2000, onQuotes = () => {}, onServed = () => {}, primaryName = "primary",
  fallbackForStale = () => true }) {
  const stages = stageList(fallbacks, fallback);
  return async (symbols = []) => {
    const fresh = (q) => {
      const e = getStockExecutionEvidenceFreshness(q, { now: now() });
      return e.quoteFresh && e.spreadFresh;
    };
    const rows = await primary(symbols).catch(() => []);
    const primaryFresh = rows.filter(fresh);
    const present = new Set((fallbackForStale() === false ? rows : primaryFresh).map((q) => normalizeSymbol(q.symbol)));
    onQuotes(primaryFresh);
    const bySymbol = new Map(rows.map((q) => [normalizeSymbol(q.symbol), q]));
    const servedBy = new Map(rows.map((q) => [normalizeSymbol(q.symbol), primaryName]));
    const fallbackRequested = {};
    // Primary successes are published above. Missing symbols get their own
    // bounded fallback window, independent of the primary quote's age.
    const deadline = Date.now() + Math.max(0, maxFallbackMs);
    for (let index = 0; index < stages.length; index += 1) {
      const missing = symbols.filter((s) => !present.has(normalizeSymbol(s)));
      const remaining = deadline - Date.now();
      if (!missing.length || remaining <= 0) break;
      // Earlier stages share what is left; the last stage may use all of it.
      const windowMs = index === stages.length - 1 ? remaining : remaining / (stages.length - index);
      fallbackRequested[stages[index].name] = missing.length;
      const extra = await runStage(stages[index], missing, windowMs);
      onQuotes(extra);
      for (const q of extra) {
        const key = normalizeSymbol(q.symbol);
        const existing = bySymbol.get(key);
        const selected = selectStockExecutionQuote(existing, q, { now: now() });
        bySymbol.set(key, selected);
        if (selected === q) servedBy.set(key, stages[index].name);
        if (fresh(selected)) present.add(key);
      }
    }
    const result = [...bySymbol.values()].map((q) => {
      const e = getStockExecutionEvidenceFreshness(q, { now: now() });
      return { ...q, priceIsLive: e.quoteFresh, priceStale: !e.quoteFresh,
        // Measurement availability and freshness are different facts. Marking
        // an old observation "unavailable" can erase a newer stream BBO.
        spreadAvailable: q.spreadAvailable === true, spreadFresh: e.spreadFresh };
    });
    const counts = {};
    for (const name of servedBy.values()) counts[name] = (counts[name] || 0) + 1;
    try {
      onServed({ at: new Date(now()).toISOString(), requested: symbols.length, returned: result.length,
        freshPairs: result.filter((q) => q.priceIsLive && q.spreadFresh).length, servedBy: counts, fallbackRequested });
    } catch { /* diagnostics must never fail a quote batch */ }
    return result;
  };
}
