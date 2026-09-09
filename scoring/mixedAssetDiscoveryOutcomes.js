import { isCryptoSignal } from './canonicalSignalRank.js';

const stockDayFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' });

function assetOf(row) {
  return isCryptoSignal(typeof row === 'string' ? { symbol: row } : row) ? 'crypto' : 'stock';
}

function withProviderEvidence(row, assetClass) {
  // Fast-runner candidates may only carry the actual memory/provider time in t.
  // Do not use updatedAt: it can be a UI/processing timestamp on those candidates.
  const providerTime = row.liveQuoteUpdatedAt || row.t || row.priceUpdatedAt || null;
  return { ...row, assetClass,
    ...(assetClass === 'stock' ? { t: providerTime } : { liveQuoteUpdatedAt: providerTime }) };
}

// A fast-runner pass can contain both asset classes. Learning must retain their
// separate calendars, benchmarks and 1/3/5-day measurement policies.
export async function ingestMixedAssetDiscoveryOutcomes(
  store, candidates = [], prices = candidates, { now = Date.now(), tradedSymbols = [] } = {}
) {
  const results = [];
  for (const assetClass of ['stock', 'crypto']) {
    const rows = candidates.filter(row => assetOf(row) === assetClass)
      .map(row => withProviderEvidence(row, assetClass));
    const quotes = prices.filter(row => assetOf(row) === assetClass)
      .map(row => withProviderEvidence(row, assetClass));
    const traded = tradedSymbols.filter(row => assetOf(row) === assetClass);
    if (!rows.length && !quotes.length && !traded.length) continue;
    const dayKey = assetClass === 'stock'
      ? stockDayFormatter.format(new Date(now)) : new Date(now).toISOString().slice(0, 10);
    // Await each cohort so one pass occupies at most one durable queue slot.
    const result = await store.ingest(rows, quotes, { assetClass, dayKey, now, tradedSymbols: traded });
    results.push({ ...result, assetClass, dayKey });
  }
  return results;
}
