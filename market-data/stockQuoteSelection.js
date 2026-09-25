import { getStockExecutionEvidenceFreshness } from "./stockQuoteEvidence.js";

// Compare complete execution quotes, not the latest trade timestamp alone.
export function selectStockExecutionQuote(previous, incoming, { now = Date.now(), maxAgeSeconds = 5 } = {}) {
  if (!previous) return incoming;
  if (!incoming) return previous;
  const ready = (quote) => {
    const evidence = getStockExecutionEvidenceFreshness(quote, { now, maxAgeSeconds });
    return quote.priceIsLive === true && evidence.quoteFresh && evidence.spreadFresh;
  };
  if (ready(previous) !== ready(incoming)) return ready(incoming) ? incoming : previous;
  const consolidated = (quote) => quote?.provenance?.isConsolidated === true
    || quote?.liveQuoteSource === "tradier_stock_quote";
  const singleExchange = (quote) => quote?.provenance?.volumeScope === "IEX_ONLY"
    || quote?.liveQuoteSource === "alpaca_latest_stock_quote";
  if (consolidated(previous) && singleExchange(incoming)) return previous;
  if (consolidated(incoming) && singleExchange(previous)) return incoming;
  const time = (quote) => Date.parse(quote.liveQuoteUpdatedAt || "") || 0;
  return time(incoming) > time(previous) ? incoming : previous;
}
