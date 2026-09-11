export function stockHistoryRequest(timeframe = '5Min', count = 30) {
  const daily = timeframe === '1Day';
  const minutes = Number(String(timeframe).match(/^([0-9]+)Min$/)?.[1]);
  if (!daily && (!Number.isInteger(minutes) || minutes < 1 || minutes > 60)) throw new Error('Unsupported stock bar interval');
  const limit = Math.max(1, Math.min(250, Math.floor(Number(count) || 30)));
  return { daily, limit, multiplier: daily ? 1 : minutes, timespan: daily ? 'day' : 'minute',
    intervalMs: daily ? 86400000 : minutes * 60000,
    // Polygon's limit counts BASE aggregates, not the requested composite bars.
    providerLimit: (limit + 2) * (daily ? 1 : minutes), outputLimit: limit + 2 };
}

export function validCompletedStockBars(rows, spec, now = Date.now()) {
  const seen = new Set();
  return (Array.isArray(rows) ? rows : []).map(bar => ({ ...bar,
    t: typeof bar.t === 'number' ? bar.t : Date.parse(bar.t),
  })).filter(bar => {
    const t = bar.t;
    if (!Number.isFinite(t) || t < now - (spec.daily ? 120 : 7) * 86400000 ||
      t + spec.intervalMs > now || seen.has(t) ||
      ![bar.o, bar.h, bar.l, bar.c, bar.v].every(Number.isFinite) ||
      Math.min(bar.o, bar.h, bar.l, bar.c) <= 0 || bar.v < 0 ||
      bar.h < Math.max(bar.o, bar.c, bar.l) || bar.l > Math.min(bar.o, bar.c)) return false;
    seen.add(t); return true;
  }).sort((a, b) => a.t - b.t).slice(-spec.limit);
}

export function createStockHistory({ polygon, alpaca, now = Date.now, onEvidence = () => {}, maxEntries = 240 }) {
  const cache = new Map(), pending = new Map();
  const providerCooldown = new Map();
  async function get(symbol, timeframe = '5Min', count = 30, options = {}) {
    const spec = stockHistoryRequest(timeframe, count);
    const key = `${symbol}:${timeframe}:${spec.limit}`;
    if (pending.has(key)) return pending.get(key);
    const hit = cache.get(key);
    if (hit && now() < hit.expiresAt) return validCompletedStockBars(hit.bars, spec, now());
    // Reject excess research work instead of accumulating an unbounded queue.
    if (pending.size >= 32) return [];
    const job = (async () => {
      let best = [], source = null;
      const errors = [];
      for (const [name, fetcher] of [['polygon', polygon], ['alpaca', alpaca]]) {
        if (!fetcher) continue;
        if (now() < (providerCooldown.get(name) || 0)) { errors.push(`${name}:COOLDOWN`); continue; }
        try {
          const bars = validCompletedStockBars(await fetcher(symbol, timeframe, spec, {
            ...options, timeoutMs: 3500,
          }), spec, now());
          if (bars.length > best.length) { best = bars; source = name; }
          if (best.length >= spec.limit) break;
        } catch (error) {
          errors.push(`${name}:${error?.status || 'UNAVAILABLE'}`);
          if ([401, 403, 429].includes(error?.status)) providerCooldown.set(name, now() + 60000);
        }
      }
      // Never discard useful Polygon history just because fallback failed or
      // returned fewer bars. Never splice providers with different adjustments.
      onEvidence({ symbol, timeframe, requested: spec.limit, completed: best.length,
        source, errors, checkedAt: new Date(now()).toISOString(),
        newestBarAt: best.length ? new Date(best.at(-1).t).toISOString() : null });
      const ttl = best.length >= spec.limit ? (spec.daily ? 1800000 : 45000) : 15000;
      cache.delete(key);
      if (cache.size >= maxEntries) cache.delete(cache.keys().next().value);
      cache.set(key, { bars: best, expiresAt: now() + ttl });
      return best;
    })().finally(() => pending.delete(key));
    pending.set(key, job);
    return job;
  }
  return { get };
}
