import test from 'node:test';
import assert from 'node:assert/strict';
import { createQuoteRefreshCoordinator } from '../market-data/quoteRefreshCoordinator.js';
const flush = () => new Promise(resolve => setImmediate(resolve));

test('slow stock requests stay pending without blocking repeated crypto refreshes', async () => {
  let now = 10000, release, stockCalls = 0, cryptoCalls = 0;
  const fresh = new Set();
  const c = createQuoteRefreshCoordinator({ now: () => now,
    fetchers: { stock: () => { stockCalls++; return new Promise(resolve => { release = resolve; }); },
      crypto: async symbols => { cryptoCalls++; return symbols; } },
    publish: symbols => { symbols.forEach(s => fresh.add(s)); return symbols.length; },
    isFresh: symbol => fresh.has(symbol),
  });
  c.refresh({ stock: ['AAPL'], crypto: ['BTC/USD'] }); await flush();
  now += 2500; c.refresh({ stock: ['AAPL'], crypto: ['BTC/USD'] }); await flush();
  assert.equal(stockCalls, 1); assert.equal(cryptoCalls, 2);
  assert.equal(c.getStatus().pending, true);
  assert.deepEqual(c.getStatus().failedSymbols, []);
  release(['AAPL']); await c.whenIdle();
  assert.equal(c.getStatus().pending, false); assert.equal(c.getStatus().freshCount, 2);
});

test('coalesces bursts, enforces bounds, reports genuine failure and recovers', async () => {
  let now = 10000, fail = true, calls = 0;
  const c = createQuoteRefreshCoordinator({ now: () => now, maxSymbols: 2,
    fetchers: { stock: async symbols => { calls++; assert.equal(symbols.length, 2);
      if (fail) throw new Error('secret provider payload'); return symbols; } },
    publish: rows => rows.length, isFresh: () => !fail,
  });
  for (let i = 0; i < 100; i++) c.refresh({ stock: ['A', 'B', 'C'] });
  await c.whenIdle(); assert.equal(calls, 1);
  assert.deepEqual(c.getStatus().errors, ['STOCK_QUOTE_REFRESH_FAILED']);
  assert.deepEqual(c.getStatus().failedSymbols, ['A', 'B']);
  now += 2001; fail = false; c.refresh({ stock: ['A', 'B'] }); await c.whenIdle();
  assert.equal(c.getStatus().ok, true); assert.deepEqual(c.getStatus().errors, []);
});
