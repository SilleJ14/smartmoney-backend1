import { getStockExecutionEvidenceFreshness } from "./stockQuoteEvidence.js";
import { executionQuoteDecision } from "../discovery/stockRealtimePipeline.js";

// Compare complete execution quotes, not the latest trade timestamp alone.
export function selectStockExecutionQuote(previous, incoming, { now = Date.now(), maxAgeSeconds = 5 } = {}) {
  if (!previous) return incoming;
  if (!incoming) return previous;
  const status = (quote) => {
    const evidence = getStockExecutionEvidenceFreshness(quote, { now, maxAgeSeconds });
    const measuredAt = Date.parse(quote.liveQuoteUpdatedAt || "");
    const source = String(quote.liveQuoteSource || quote.source || "").toLowerCase();
    const decision = executionQuoteDecision({
      provider: quote.provider || quote.provenance?.provider
        || (source.includes("tradier") ? "TRADIER" : source.includes("alpaca") ? "ALPACA" : null),
      feed: quote.feed || quote.provenance?.feed
        || (source.includes("tradier") ? "REALTIME_CONSOLIDATED" : source.includes("alpaca") ? "IEX" : null),
      timing: quote.timing || quote.provenance?.timing || null,
      ageMs: Number.isFinite(measuredAt) ? now - measuredAt : null,
      spreadPercent: quote.spreadAvailable === true ? quote.spreadPercent : null,
    });
    const pairFresh = quote.priceIsLive === true && evidence.quoteFresh && evidence.spreadFresh;
    return { pairFresh, executable: pairFresh && decision.satisfiesExecution === true };
  };
  const previousStatus = status(previous);
  const incomingStatus = status(incoming);
  if (previousStatus.executable !== incomingStatus.executable) return incomingStatus.executable ? incoming : previous;
  if (previousStatus.pairFresh !== incomingStatus.pairFresh) return incomingStatus.pairFresh ? incoming : previous;
  const consolidated = (quote) => quote?.provenance?.isConsolidated === true
    || quote?.liveQuoteSource === "tradier_stock_quote";
  const singleExchange = (quote) => quote?.provenance?.volumeScope === "IEX_ONLY"
    || ["alpaca_latest_stock_quote", "alpaca_iex"].includes(quote?.liveQuoteSource);
  if (consolidated(previous) && singleExchange(incoming)) return previous;
  if (consolidated(incoming) && singleExchange(previous)) return incoming;
  const time = (quote) => Date.parse(quote.liveQuoteUpdatedAt || "") || 0;
  return time(incoming) > time(previous) ? incoming : previous;
}
