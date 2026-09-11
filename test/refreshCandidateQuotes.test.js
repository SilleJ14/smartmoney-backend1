import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { refreshCandidateQuotes } from '../market-data/refreshCandidateQuotes.js';
import { createStockExecutionQuoteRefresher } from '../market-data/stockExecutionQuoteRefresh.js';
import { createCryptoExecutionQuoteRefresher } from '../market-data/cryptoExecutionQuoteRefresh.js';

test('a rejected older REST response still uses the newer stream cache at the decision boundary', async () => {
  const now = new Date().toISOString();
  for (const [factory, symbol, source] of [[createStockExecutionQuoteRefresher, 'AAPL', 'tradier_stock_quote'],
    [createCryptoExecutionQuoteRefresher, 'BTC/USD', 'alpaca_crypto_latest']]) {
    const fresh = { symbol, price: 100, bid: 99.99, ask: 100.01, spreadAvailable: true,
      spreadUpdatedAt: now, liveQuoteUpdatedAt: now, liveQuoteSource: source, spreadSource: source, priceIsLive: true };
    for (const result of [[], [{ ...fresh, price: 95, liveQuoteUpdatedAt: '2026-01-01T00:00:00Z' }]]) {
      const refresh = factory({ normalizeSymbol: String, getLatestQuotes: async () => result,
        updateQuoteCache: () => null, getCachedQuote: () => fresh });
      const [row] = await refresh([{ symbol, price: 90, approved: false }]);
      assert.equal(row.price, 100);
      assert.equal(row.spreadUpdatedAt, now);
      assert.equal(row.approved, false, 'stream recovery must not invent authorization');
    }
  }
});

test('stock and crypto refresh both start without waiting for the other provider', async () => {
  const starts = [], release = {};
  const provider = name => rows => {
    starts.push(name);
    return new Promise(resolve => { release[name] = () => resolve(rows.map(row => ({ ...row, provider: name }))); });
  };
  const pending = refreshCandidateQuotes([{ symbol: 'AAPL' }], [{ symbol: 'BTC/USD' }], provider('stocks'), provider('crypto'));
  await Promise.resolve();
  assert.deepEqual(starts, ['stocks', 'crypto']);
  release.crypto(); release.stocks();
  const [stocks, crypto] = await pending;
  assert.equal(stocks[0].provider, 'stocks');
  assert.equal(crypto[0].provider, 'crypto');
  assert.equal(stocks[0].approved, undefined, 'a refresh must not invent approval');
});

test('empty/disabled asset lanes do not consume provider requests', async () => {
  const row = { symbol: 'BTC/USD', approved: false };
  const [stocks, crypto] = await refreshCandidateQuotes([], [row], () => assert.fail('empty lane'), undefined);
  assert.deepEqual(stocks, []);
  assert.equal(crypto[0], row);
});

test('both central passes and final sizing refresh both asset classes', () => {
  const code = fs.readFileSync(new URL('../engine/createEngineCycle.js', import.meta.url), 'utf8');
  assert.equal((code.match(/await refreshCandidateQuotes\(/g) || []).length, 3);
  for (const boundary of ['const earlyCentralAutonomousDecisionCore', 'const centralAutonomousDecisionCore', 'for (const signal of stockSignals) {\n        if (']) {
    const normalized = code.replaceAll('\r\n', '\n');
    const offset = normalized.indexOf(boundary);
    assert.ok(offset > 0);
    assert.match(normalized.slice(offset - 290, offset), /refreshStockExecutionQuotes, refreshCryptoExecutionQuotes/);
  }
});
