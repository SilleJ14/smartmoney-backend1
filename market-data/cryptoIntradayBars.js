// Cache evidence, never manufacture candles or refresh provider timestamps.
export function createCryptoIntradayBars({ getRecentBars, normalizeSymbol, maxSymbols = 250, historyLimit = 30, now = Date.now }) {
  const cache = new Map();
  const pending = new Map();
  const capacity = Math.max(1, Math.min(300, Number(maxSymbols) || 250));
  const limit = Math.max(30, Math.min(220, Number(historyLimit) || 30));
  function retain(symbol, bars, ttl) {
    cache.delete(symbol);
    cache.set(symbol, { bars: bars.slice(-limit), expiresAt: now() + ttl });
    while (cache.size > capacity) cache.delete(cache.keys().next().value);
    return cache.get(symbol).bars;
  }
  async function load(symbol) {
    let best = [];
    for (const timeframe of ['5Min', '1Min', '15Min']) {
      let bars;
      try { bars = await getRecentBars(symbol, timeframe, limit); }
      catch { continue; }
      if (!Array.isArray(bars)) continue;
      // A short real window is preferable to losing all evidence. It still
      // cannot pass the scorer's ten-bar requirement.
      if (bars.length > best.length) best = bars.slice(-limit);
      if (bars.length >= 10) return retain(symbol, bars, 120_000);
    }
    // A temporary outage must not hide a recovered provider for two minutes.
    return retain(symbol, best, 5_000);
  }
  return {
    get(symbol) {
      const clean = normalizeSymbol(symbol);
      if (!clean) return Promise.resolve([]);
      const saved = cache.get(clean);
      if (saved && now() < saved.expiresAt) return Promise.resolve(saved.bars);
      if (pending.has(clean)) return pending.get(clean);
      // Normal scans have bounded concurrency; also bound unexpected callers.
      if (pending.size >= capacity) return Promise.resolve([]);
      const request = load(clean).finally(() => pending.delete(clean));
      pending.set(clean, request);
      return request;
    },
    getStatus: () => ({ cachedSymbols: cache.size, pendingSymbols: pending.size, capacity }),
  };
}
