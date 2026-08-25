function normalizeSymbol(value) {
  return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9.-]/g, "");
}

export async function fetchAlpacaStockOutcomeQuotes(
  symbols = [],
  { dataRequest, maxSymbols = 20 } = {}
) {
  if (typeof dataRequest !== "function") return [];
  const cleanSymbols = [...new Set(
    (Array.isArray(symbols) ? symbols : [])
      .map(normalizeSymbol)
      .filter(Boolean)
  )].slice(0, Math.max(1, Number(maxSymbols || 20)));
  if (cleanSymbols.length === 0) return [];
  const data = await dataRequest(
    `/v2/stocks/quotes/latest?symbols=${encodeURIComponent(cleanSymbols.join(","))}&feed=iex`
  );
  const quotes = data?.quotes || {};
  return cleanSymbols.flatMap((symbol) => {
    const quote = quotes[symbol] || {};
    const bid = Number(quote.bp || quote.bid || 0);
    const ask = Number(quote.ap || quote.ask || 0);
    if (!(bid > 0) || !(ask >= bid)) return [];
    const price = (bid + ask) / 2;
    return [{
      symbol,
      current: price,
      price,
      bid,
      ask,
      spreadPercent: price > 0 ? ((ask - bid) / price) * 100 : null,
      liveQuoteSource: "alpaca_outcome_followup",
      outcomeFollowupOnly: true,
    }];
  });
}

