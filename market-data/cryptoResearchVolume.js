// Volume confirmation only: no research price/BBO is copied to execution data.
export function createCryptoResearchVolume({ getBars, now = Date.now }) {
  const cache = new Map(), pending = new Map();
  return async (symbol, bars) => {
    if (!Array.isArray(bars) || bars.some(b => !b || typeof b !== 'object' || Array.isArray(b))) return [];
    const interval = bars.at(-1)?.intervalMs;
    if (![60000, 300000, 900000].includes(interval)) return bars;
    const key = `${symbol}:${interval}`;
    let saved = cache.get(key);
    if (!saved || now() >= saved.expires) {
      if (!pending.has(key)) {
        if (pending.size >= 8) return bars;
        pending.set(key, (async () => {
          let rows = [];
          try {
            const received = await getBars(symbol, `${interval / 60000}Min`, 220);
            rows = received.map(b => ({ time: typeof b.t === 'number' ? b.t : Date.parse(b.t), volume: b.v }))
              .filter(b => Number.isFinite(b.time) && b.time + interval <= now() &&
                typeof b.volume === 'number' && Number.isFinite(b.volume) && b.volume >= 0);
          } catch { /* retain venue evidence */ }
          const value = { rows, expires: now() + (rows.length ? 120000 : 30000) };
          cache.delete(key); cache.set(key, value);
          while (cache.size > 250) cache.delete(cache.keys().next().value);
          return value;
        })().finally(() => pending.delete(key)));
      }
      saved = await pending.get(key);
    }
    const volumes = new Map(saved.rows.map(b => [b.time, b.volume]));
    return bars.map(b => {
      const time = typeof b.t === 'number' ? b.t : Date.parse(b.t);
      return { ...b, marketVolume: volumes.get(time) ?? null,
        marketVolumeSource: 'alpaca_kraken_research_bars' };
    });
  };
}
