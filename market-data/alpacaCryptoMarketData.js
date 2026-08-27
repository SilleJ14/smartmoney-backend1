import { normalizeDiscoveryBars } from "../scoring/earlyDiscovery.js";

function providerTimestamp(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  const parsed = Number.isFinite(numeric)
    ? numeric < 10_000_000_000 ? numeric * 1000 : numeric
    : Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function timeframeMilliseconds(timeframe = "5Min") {
  const clean = String(timeframe || "5Min").trim();
  const match = clean.match(/^(\d+)(Min|T|Hour|H|Day|D|Week|W|Month|M)$/i);
  if (!match) return 5 * 60 * 1000;
  const count = Math.max(1, Number(match[1]) || 1);
  const unit = match[2].toLowerCase();
  if (unit === "min" || unit === "t") return count * 60 * 1000;
  if (unit === "hour" || unit === "h") return count * 60 * 60 * 1000;
  if (unit === "day" || unit === "d") return count * 24 * 60 * 60 * 1000;
  if (unit === "week" || unit === "w") return count * 7 * 24 * 60 * 60 * 1000;
  return count * 31 * 24 * 60 * 60 * 1000;
}

function historicalBarsPath(symbol, timeframe, limit, now) {
  const cleanLimit = Math.min(10_000, Math.max(1, Number(limit) || 30));
  const end = now instanceof Date ? now : new Date(now);
  const safeEnd = Number.isFinite(end.getTime()) ? end : new Date();
  // Alpaca defaults `start` to the beginning of the current day. That returns
  // only one daily candle and the oldest intraday bars, which leaves discovery
  // without the 20-day evidence it requires. Request a small explicit lookback
  // and sort newest-first; normalization below restores chronological order.
  const lookbackIntervals = cleanLimit + Math.max(5, Math.ceil(cleanLimit * 0.2));
  const start = new Date(
    safeEnd.getTime() - timeframeMilliseconds(timeframe) * lookbackIntervals
  );
  const params = new URLSearchParams({
    symbols: symbol,
    timeframe: String(timeframe || "5Min"),
    start: start.toISOString(),
    end: safeEnd.toISOString(),
    limit: String(cleanLimit),
    sort: "desc",
  });
  return `/v1beta3/crypto/us/bars?${params.toString()}`;
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
    const data = await dataRequest(
      historicalBarsPath(cleanSymbol, timeframe, limit, now())
    );
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
