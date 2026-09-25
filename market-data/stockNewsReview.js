import { calculateNewsCatalyst } from '../scoring/newsCatalyst.js';
import { createHash } from 'node:crypto';

export function createStockNewsReview({ providers, now = Date.now, onEvidence = () => {}, maxEntries = 250, cacheMs = 60000 }) {
  const cache = new Map(), pending = new Map(), cooldowns = new Map();
  const unavailable = (reason, extra = {}) => ({ available: false, risk: false, reason,
    headlines: [], allHeadlines: [], articles: [], catalyst: calculateNewsCatalyst({ dataAvailable: false }), ...extra });
  function get(symbol) {
    const hit = cache.get(symbol);
    if (hit && now() < hit.expiresAt) return Promise.resolve(hit.value);
    if (pending.has(symbol)) return pending.get(symbol);
    if (pending.size >= 8) return Promise.resolve(unavailable('News review capacity reached; retry required'));
    const job = (async () => {
      const errors = [];
      for (const [name, request] of Object.entries(providers)) {
        if (!request) continue;
        if (now() < (cooldowns.get(name) || 0)) { errors.push(`${name}:COOLDOWN`); continue; }
        try {
          const raw = await request(symbol);
          if (!Array.isArray(raw)) throw new Error('Malformed news response');
          const articles = raw.filter(item => item && typeof item.headline === 'string').slice(0, 50).map(item => ({
            headline: item.headline.slice(0, 500), summary: String(item.summary || '').slice(0, 2000),
            datetime: Number(item.datetime) || Date.parse(item.created_at || '') / 1000,
            source: String(item.source || name).slice(0, 80),
          }));
          if (raw.length && (!articles.length || articles.some(item => !Number.isFinite(item.datetime) || item.datetime * 1000 > now() + 5000))) {
            throw new Error('Malformed or future news evidence');
          }
          const catalyst = calculateNewsCatalyst({
            articles, dataAvailable: true, source: name, now: now(),
            coverageMode: "SYMBOL_SCOPED",
            coverageReason: "SYMBOL_SCOPED_PROVIDER_RESULT",
            sources: [name],
          });
          const value = { available: true, risk: catalyst.riskDetected,
            reason: catalyst.riskDetected ? 'Risky news detected' : articles.length ? 'News checked; no major risk detected' : 'News checked; no headlines returned',
            headlines: catalyst.riskDetected ? catalyst.headlines.slice(0, 3) : [],
            allHeadlines: catalyst.headlines, articles, catalyst, source: name,
            reviewCoverage: { status: catalyst.riskDetected ? 'RISK_FOUND' : 'CLEAR_WITHIN_REVIEWED_COVERAGE',
              provider: name, checkedAt: new Date(now()).toISOString(), returnedCount: raw.length,
              reviewedCount: articles.length, resultLimit: 50,
              oldestArticleAt: articles.length ? new Date(Math.min(...articles.map(a => a.datetime)) * 1000).toISOString() : null,
              newestArticleAt: articles.length ? new Date(Math.max(...articles.map(a => a.datetime)) * 1000).toISOString() : null,
              scope: 'Returned provider results only; absence of a headline is not proof of no material news' },
            fetchedAt: new Date(now()).toISOString(), cacheStatus: 'fresh', errors };
          remember(symbol, value, cacheMs);
          const material = articles.filter(article => {
            const assessment = calculateNewsCatalyst({ articles: [article], dataAvailable: true, source: name, now: now() });
            return assessment.catalystAvailable && now() - article.datetime * 1000 <= 86400000;
          });
          onEvidence({ symbol, available: true, source: name, count: articles.length, errors, checkedAt: value.fetchedAt,
            materialVersion: material.length ? createHash('sha256').update([...new Set(material.map(a => `${a.datetime}:${a.headline.toLowerCase().replace(/\W/g, '')}`))].sort().join('|')).digest('hex') : null });
          return value;
        } catch (error) {
          errors.push(`${name}:${error?.status || 'UNAVAILABLE'}`);
          // Short provider backoff prevents each scanned symbol repeating an outage.
          cooldowns.set(name, now() + ([401, 403, 429].includes(error?.status) ? 60000 : 15000));
        }
      }
      const value = unavailable('News providers unavailable; risk review incomplete', {
        errors, cacheStatus: 'unavailable', fetchedAt: null,
      });
      remember(symbol, value, 15000);
      onEvidence({ symbol, available: false, errors, checkedAt: new Date(now()).toISOString() });
      return value;
    })().finally(() => pending.delete(symbol));
    pending.set(symbol, job);
    return job;
  }
  function remember(symbol, value, ttl) {
    cache.delete(symbol);
    if (cache.size >= maxEntries) cache.delete(cache.keys().next().value);
    cache.set(symbol, { value, expiresAt: now() + ttl });
  }
  return { get };
}
