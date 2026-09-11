// Market-data only. No account, order or trading endpoints belong in this adapter.
const LIVE_BASE = "https://api.tradier.com/v1";
const MAX_SYMBOLS = 120;
const finitePositive = (value) => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : null;
const timestamp = (value, now) => {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  const ms = Number.isFinite(number) ? (number < 1e10 ? number * 1000 : number) : Date.parse(value);
  return Number.isFinite(ms) && ms > 0 && ms <= now + 5000 ? ms : null;
};

export function normalizeTradierQuote(raw = {}, { now = Date.now(), sandbox = false } = {}) {
  const symbol = String(raw.symbol || "").trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol) || !["stock", "etf"].includes(raw.type)) return null;
  const bid = finitePositive(raw.bid);
  const ask = finitePositive(raw.ask);
  const bidTime = timestamp(raw.bid_date, now);
  const askTime = timestamp(raw.ask_date, now);
  const tradeTime = timestamp(raw.trade_date, now);
  const spreadTime = bidTime !== null && askTime !== null ? Math.min(bidTime, askTime) : null;
  const spreadAvailable = bid !== null && ask !== null && ask >= bid && spreadTime !== null && !sandbox;
  const last = finitePositive(raw.last);
  // Select price and its own timestamp atomically. Never attach trade time to a pair.
  const useMid = spreadAvailable && (tradeTime === null || spreadTime >= tradeTime);
  const price = useMid ? (bid + ask) / 2 : last;
  const priceTime = useMid ? spreadTime : tradeTime;
  if (price === null || priceTime === null) return null;
  const previousClose = finitePositive(raw.prevclose);
  const source = sandbox ? "tradier_delayed_quote" : "tradier_stock_quote";
  const iso = (time) => time === null ? null : new Date(time).toISOString();
  return {
    symbol, assetClass: "stock", price, current: price, livePrice: price,
    lastTradePrice: last, tradeUpdatedAt: iso(tradeTime),
    previousClose, open: finitePositive(raw.open), high: finitePositive(raw.high), low: finitePositive(raw.low),
    volume: Math.max(0, Number(raw.volume) || 0), averageVolume: Math.max(0, Number(raw.average_volume) || 0),
    percentChange: previousClose ? ((price - previousClose) / previousClose) * 100 : null,
    percentChangeAvailable: previousClose !== null,
    percentChangeReferencePrice: previousClose, percentChangeSource: source,
    bid: spreadAvailable ? bid : 0, ask: spreadAvailable ? ask : 0,
    bidUpdatedAt: iso(bidTime), askUpdatedAt: iso(askTime),
    spreadAvailable, spreadPercent: spreadAvailable ? ((ask - bid) / ((ask + bid) / 2)) * 100 : null,
    spreadUpdatedAt: spreadAvailable ? iso(spreadTime) : null,
    bidAskUpdatedAt: spreadAvailable ? iso(spreadTime) : null, spreadSource: source,
    liveQuoteUpdatedAt: iso(priceTime), quoteUpdatedAt: iso(priceTime), quoteFetchedAt: iso(priceTime),
    source, liveQuoteSource: source, priceIsLive: !sandbox && now - priceTime <= 5000,
    receivedAt: iso(now), delayed: sandbox,
  };
}

export function createTradierMarketData({ apiKey = process.env.TRADIER_API_KEY,
  sandbox = process.env.TRADIER_SANDBOX === "true", fetchImpl = fetch, now = Date.now } = {}) {
  let blockedUntil = 0;
  let windowStart = 0;
  let requests = 0;
  const pending = new Map();
  let status = { configured: Boolean(apiKey), sandbox, lastSuccessAt: null, lastError: null };
  async function getLatestQuotes(symbols = []) {
    const selected = [...new Set(symbols.map((s) => String(s).trim().toUpperCase()))]
      .filter((s) => /^[A-Z][A-Z0-9.-]{0,9}$/.test(s)).slice(0, MAX_SYMBOLS).sort();
    if (!apiKey || !selected.length) return [];
    const key = selected.join(",");
    if (pending.has(key)) return pending.get(key);
    const time = now();
    if (time < blockedUntil) { status = { ...status, lastSkipReason: "PROVIDER_BACKOFF" }; return []; }
    if (time - windowStart >= 60000) { windowStart = time; requests = 0; }
    if (requests >= (sandbox ? 45 : 90)) { status = { ...status, lastSkipReason: "LOCAL_RATE_BUDGET" }; return []; }
    requests += 1;
    const request = (async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2000);
      try {
        const base = sandbox ? "https://sandbox.tradier.com/v1" : LIVE_BASE;
        const response = await fetchImpl(`${base}/markets/quotes?symbols=${encodeURIComponent(key)}`, {
          headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" }, signal: controller.signal,
        });
        const remaining = Number(response.headers?.get("x-ratelimit-available"));
        if (response.status === 429 || remaining === 0 && response.headers?.get("x-ratelimit-available") !== null) {
          const expiry = Number(response.headers?.get("x-ratelimit-expiry"));
          blockedUntil = Math.min(now() + 60000, Math.max(now() + 1000,
            Number.isFinite(expiry) && expiry > now() ? expiry : now() + 60000));
        }
        if (!response.ok) throw new Error(`Tradier market data HTTP ${response.status}`);
        let payload;
        if (response.body?.[Symbol.asyncIterator]) {
          const chunks = [];
          let bytes = 0;
          for await (const chunk of response.body) {
            bytes += chunk.byteLength;
            if (bytes > 2 * 1024 * 1024) { controller.abort(); throw new Error("Response budget exceeded"); }
            chunks.push(Buffer.from(chunk));
          }
          payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        } else {
          payload = await response.json();
        }
        const rows = payload?.quotes?.quote;
        const quotes = (Array.isArray(rows) ? rows : rows ? [rows] : []).slice(0, MAX_SYMBOLS)
          .filter((row) => selected.includes(row.symbol))
          .map((row) => normalizeTradierQuote(row, { now: now(), sandbox })).filter(Boolean);
        status = { ...status, lastSuccessAt: quotes.length ? new Date(now()).toISOString() : status.lastSuccessAt,
          lastError: quotes.length ? null : "NO_VALID_QUOTES", lastSkipReason: null, returnedCount: quotes.length };
        return quotes;
      } catch (error) {
        // Never include URLs, headers or provider payloads in errors exposed to the app.
        status = { ...status, lastError: error?.name === "AbortError" ? "TRADIER_TIMEOUT" : "TRADIER_REQUEST_FAILED" };
        blockedUntil = Math.max(blockedUntil, now() + 5000);
        return [];
      } finally { clearTimeout(timer); }
    })().finally(() => pending.delete(key));
    pending.set(key, request);
    return request;
  }
  return { getLatestQuotes, getStatus: () => ({ ...status, requestsInWindow: requests, blockedUntil }) };
}
