import test from 'node:test';
import assert from 'node:assert/strict';
import { createStockExecutionQuoteRefresher } from '../market-data/stockExecutionQuoteRefresh.js';
import { createCryptoExecutionQuoteRefresher } from '../market-data/cryptoExecutionQuoteRefresh.js';

for (const [asset, create] of [['stock', createStockExecutionQuoteRefresher], ['crypto', createCryptoExecutionQuoteRefresher]]) {
  test(`${asset} bulk quote reassessment services I/O between batches without dropping candidates`, async () => {
    let processed = 0, servicedAt = null;
    const rows = Array.from({ length: 13 }, (_, i) => ({ symbol: `TEST${i}` }));
    const refresh = create({
      normalizeSymbol: s => s,
      getLatestQuotes: async () => [],
      getCachedQuote: () => {
        processed++;
        if (processed === 4) setImmediate(() => { servicedAt = processed; });
        return null;
      },
    });
    const result = await refresh(rows);
    assert.equal(servicedAt, 4);
    assert.equal(processed, rows.length);
    assert.deepEqual(result, rows);
  });
}
