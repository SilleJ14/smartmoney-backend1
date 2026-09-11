import { buildMeasuredPercentChangePatch } from "../live/liveQuoteCache.js";
import { revalidateCandidate } from "../scoring/revalidateCandidate.js";

export function createStockExecutionQuoteRefresher({
  getLatestQuotes,
  normalizeSymbol,
  updateQuoteCache,
  getCachedQuote = () => null,
  onError = () => {},
} = {}) {
  return async function refreshStockExecutionQuotes(signals = []) {
    const sourceSignals = Array.isArray(signals) ? signals : [];
    const symbols = [...new Set(
      sourceSignals
        .map((signal) => normalizeSymbol(signal?.symbol))
        .filter(Boolean)
    )];
    if (symbols.length === 0 || typeof getLatestQuotes !== "function") {
      return sourceSignals;
    }

    let quotes;
    try {
      quotes = await getLatestQuotes(symbols);
    } catch (error) {
      onError(error);
      return sourceSignals;
    }
    const quoteBySymbol = new Map(
      (Array.isArray(quotes) ? quotes : [])
        .map((quote) => [normalizeSymbol(quote?.symbol), quote])
        .filter(([symbol, quote]) => symbol && quote)
    );

    return sourceSignals.map((signal) => {
      const symbol = normalizeSymbol(signal?.symbol);
      const quote = quoteBySymbol.get(symbol);
      const cached = (quote ? updateQuoteCache(symbol, {
        ...quote,
        source: quote.source || quote.liveQuoteSource || "alpaca_latest_stock_quote",
        liveQuoteSource:
          quote.liveQuoteSource || quote.source || "alpaca_latest_stock_quote",
        spreadUpdatedAt: quote.spreadUpdatedAt || quote.bidAskUpdatedAt || null,
        bidAskUpdatedAt: quote.bidAskUpdatedAt || quote.spreadUpdatedAt || null,
        spreadSource:
          quote.spreadSource || quote.liveQuoteSource || quote.source || null,
      }) : null) || getCachedQuote(symbol);
      if (!cached?.price) return signal;
      const percentPatch = buildMeasuredPercentChangePatch(
        signal,
        cached,
        { price: cached.price }
      );
      const refreshed = {
        ...signal,
        price: cached.price,
        current: cached.price,
        livePrice: cached.price,
        displayPrice: cached.price,
        bid: cached.spreadAvailable === true ? cached.bid : null,
        ask: cached.spreadAvailable === true ? cached.ask : null,
        spread: cached.spread,
        spreadPercent: cached.spreadPercent,
        spreadAvailable: cached.spreadAvailable === true,
        spreadUpdatedAt: cached.spreadUpdatedAt || null,
        bidAskUpdatedAt: cached.bidAskUpdatedAt || null,
        spreadSource: cached.spreadSource || null,
        liveQuoteUpdatedAt: cached.liveQuoteUpdatedAt || null,
        quoteFetchedAt: cached.liveQuoteUpdatedAt || null,
        liveQuoteSource:
          cached.liveQuoteSource || cached.source || "alpaca_latest_stock_quote",
        priceIsLive: cached.priceIsLive === true,
        priceStale: cached.priceIsLive !== true,
        liveQuote: {
          ...cached,
          updatedAt: cached.liveQuoteUpdatedAt || cached.updatedAt || null,
        },
        ...percentPatch,
      };
      return revalidateCandidate(signal, refreshed);
    });
  };
}
