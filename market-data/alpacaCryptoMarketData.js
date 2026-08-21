export function createAlpacaCryptoMarketData({ dataRequest, normalizeSymbol, now = () => new Date() }) {
  async function getLatestQuote(symbol) {
    const cleanSymbol = normalizeSymbol(symbol);
    try {
      const data = await dataRequest(`/v1beta3/crypto/us/latest/quotes?symbols=${encodeURIComponent(cleanSymbol)}`);
      const quote = data?.quotes?.[cleanSymbol] || data?.quotes?.[cleanSymbol.replace("/", "")] || null;
      const bid = Number(quote?.bp || quote?.bid_price || quote?.bid || 0);
      const ask = Number(quote?.ap || quote?.ask_price || quote?.ask || 0);
      let price = bid > 0 && ask > 0 ? (bid + ask) / 2 : bid > 0 ? bid : ask > 0 ? ask : 0;
      if (price <= 0) {
        const tradeData = await dataRequest(`/v1beta3/crypto/us/latest/trades?symbols=${encodeURIComponent(cleanSymbol)}`);
        const trade = tradeData?.trades?.[cleanSymbol] || tradeData?.trades?.[cleanSymbol.replace("/", "")] || null;
        price = Number(trade?.p || trade?.price || 0);
      }
      if (price <= 0) throw new Error(`Invalid Alpaca crypto price for ${symbol}`);
      return {
        symbol, current: price, price, bid, ask, previousClose: 0,
        changePercent: 0, percentChange: 0, assetClass: "crypto",
        liveQuoteSource: "alpaca_crypto_latest", source: "alpaca_crypto_latest",
        quoteFetchedAt: now().toISOString(), priceIsLive: true, priceStale: false, raw: quote,
      };
    } catch (error) {
      throw new Error(`Alpaca crypto quote failed for ${symbol}: ${error.message}`);
    }
  }

  async function getRecentBars(symbol, timeframe = "5Min", limit = 30) {
    const cleanSymbol = normalizeSymbol(symbol);
    const data = await dataRequest(`/v1beta3/crypto/us/bars?symbols=${encodeURIComponent(cleanSymbol)}&timeframe=${encodeURIComponent(timeframe)}&limit=${limit}`);
    const bars = data?.bars?.[cleanSymbol] || data?.bars?.[cleanSymbol.replace("/", "")] || [];
    return Array.isArray(bars) ? bars.map((bar) => ({
      t: bar.t, o: Number(bar.o || 0), h: Number(bar.h || 0), l: Number(bar.l || 0),
      c: Number(bar.c || 0), v: Number(bar.v || 0), source: "alpaca_crypto_bars",
    })).filter((bar) => bar.c > 0) : [];
  }
  return { getLatestQuote, getRecentBars };
}
