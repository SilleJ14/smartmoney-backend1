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
  const time = (quote) => Date.parse(quote.liveQuoteUpdatedAt || "") || 0;
  return time(incoming) > time(previous) ? incoming : previous;
}
