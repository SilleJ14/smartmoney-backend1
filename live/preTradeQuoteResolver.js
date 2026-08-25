export async function resolvePreTradeQuote({
  cachedQuote = null,
  isQuoteReady = () => false,
  fetchFallback,
  storeFallback = (quote) => quote,
} = {}) {
  if (cachedQuote && isQuoteReady(cachedQuote)) {
    return {
      quote: cachedQuote,
      usedFallback: false,
      fallbackAttempted: false,
      fallbackError: null,
    };
  }

  if (typeof fetchFallback !== "function") {
    return {
      quote: cachedQuote || {},
      usedFallback: false,
      fallbackAttempted: false,
      fallbackError: null,
    };
  }

  try {
    const fallbackQuote = await fetchFallback();
    const storedQuote = fallbackQuote
      ? storeFallback(fallbackQuote) || fallbackQuote
      : null;
    return {
      quote: storedQuote || cachedQuote || {},
      usedFallback: Boolean(storedQuote),
      fallbackAttempted: true,
      fallbackError: null,
    };
  } catch (error) {
    return {
      quote: cachedQuote || {},
      usedFallback: false,
      fallbackAttempted: true,
      fallbackError: error?.message || String(error),
    };
  }
}
