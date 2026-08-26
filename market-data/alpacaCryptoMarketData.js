import { normalizeDiscoveryBars } from "../scoring/earlyDiscovery.js";

function providerTimestamp(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  const parsed = Number.isFinite(numeric)
    ? numeric < 10_000_000_000 ? numeric * 1000 : numeric
    : Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

export function createAlpacaCryptoMarketData({ dataRequest, normalizeSymbol, now = () => new Date() }) {
  async function getLatestQuote(symbol) {
    const cleanSymbol = normalizeSymbol(symbol);
    try {
      const data = await dataRequest(`/v1beta3/crypto/us/latest/quotes?symbols=${encodeURIComponent(cleanSymbol)}`);
      const quote = data?.quotes?.[cleanSymbol] || data?.quotes?.[cleanSymbol.replace("/", "")] || null;
      const bid = Number(quote?.bp || quote?.bid_price || quote?.bid || 0);
      const ask = Number(quote?.ap || quote?.ask_price || quote?.ask || 0);
      let price = bid > 0 && ask > 0 ? (bid + ask) / 2 : bid > 0 ? bid : ask > 0 ? ask : 0;
      let marketEvent = quote;
      if (price <= 0) {
        const tradeData = await dataRequest(`/v1beta3/crypto/us/latest/trades?symbols=${encodeURIComponent(cleanSymbol)}`);
        const trade = tradeData?.trades?.[cleanSymbol] || tradeData?.trades?.[cleanSymbol.replace("/", "")] || null;
        price = Number(trade?.p || trade?.price || 0);
        marketEvent = trade;
      }
      if (price <= 0) throw new Error(`Invalid Alpaca crypto price for ${symbol}`);
      const eventTimestamp = providerTimestamp(
        marketEvent?.t ?? marketEvent?.timestamp ?? marketEvent?.time
      );
      return {
        symbol, current: price, price, bid, ask, previousClose: 0,
        changePercent: 0, percentChange: 0, assetClass: "crypto",
        liveQuoteSource: "alpaca_crypto_latest", source: "alpaca_crypto_latest",
        quoteFetchedAt: eventTimestamp,
        liveQuoteUpdatedAt: eventTimestamp,
        providerTimestampAvailable: Boolean(eventTimestamp),
        fetchedAt: now().toISOString(),
        priceIsLive: Boolean(eventTimestamp),
        priceStale: !eventTimestamp,
        raw: quote,
      };
    } catch (error) {
      throw new Error(`Alpaca crypto quote failed for ${symbol}: ${error.message}`);
    }
  }

  async function getRecentBars(symbol, timeframe = "5Min", limit = 30) {
    const cleanSymbol = normalizeSymbol(symbol);
    const data = await dataRequest(`/v1beta3/crypto/us/bars?symbols=${encodeURIComponent(cleanSymbol)}&timeframe=${encodeURIComponent(timeframe)}&limit=${limit}`);
    const bars = data?.bars?.[cleanSymbol] || data?.bars?.[cleanSymbol.replace("/", "")] || [];
    return normalizeDiscoveryBars(Array.isArray(bars) ? bars : [])
      .map((bar) => ({
        t: bar.time ?? undefined,
        o: bar.open,
        h: bar.high,
        l: bar.low,
        c: bar.close,
        v: bar.volume,
        source: "alpaca_crypto_bars",
      }));
  }
  return { getLatestQuote, getRecentBars };
}
