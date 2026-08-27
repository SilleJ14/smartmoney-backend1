export async function resolvePreTradeQuote({
  cachedQuote = null,
  isQuoteReady = () => false,
  fetchFallback,
  storeFallback = (quote) => quote,
  maxFallbackAttempts = 1,
  retryDelayMs = 0,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  if (cachedQuote && isQuoteReady(cachedQuote)) {
    return {
      quote: cachedQuote,
      quoteReady: true,
      usedFallback: false,
      fallbackAttempted: false,
      fallbackAttempts: 0,
      fallbackError: null,
    };
  }

  if (typeof fetchFallback !== "function") {
    return {
      quote: cachedQuote || {},
      quoteReady: false,
      usedFallback: false,
      fallbackAttempted: false,
      fallbackAttempts: 0,
      fallbackError: null,
    };
  }

  const attemptLimit = Math.max(1, Math.min(3, Number(maxFallbackAttempts) || 1));
  const delayMs = Math.max(0, Math.min(2_000, Number(retryDelayMs) || 0));
  let latestQuote = cachedQuote || {};
  let fallbackAttempts = 0;
  let usedFallback = false;
  let fallbackError = null;

  for (let attempt = 0; attempt < attemptLimit; attempt += 1) {
    if (attempt > 0 && delayMs > 0) await sleep(delayMs);
    fallbackAttempts += 1;
    try {
      const fallbackQuote = await fetchFallback();
      const storedQuote = fallbackQuote
        ? storeFallback(fallbackQuote) || fallbackQuote
        : null;
      if (storedQuote) {
        latestQuote = storedQuote;
        usedFallback = true;
      }
      fallbackError = null;
      if (storedQuote && isQuoteReady(storedQuote)) {
        return {
          quote: storedQuote,
          quoteReady: true,
          usedFallback: true,
          fallbackAttempted: true,
          fallbackAttempts,
          fallbackError: null,
        };
      }
    } catch (error) {
      fallbackError = error?.message || String(error);
    }
  }

  return {
    quote: latestQuote,
    quoteReady: isQuoteReady(latestQuote),
    usedFallback,
    fallbackAttempted: fallbackAttempts > 0,
    fallbackAttempts,
    fallbackError,
  };
}
