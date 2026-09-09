import test from 'node:test';
import assert from 'node:assert/strict';
import { createCryptoIntradayBars } from '../market-data/cryptoIntradayBars.js';

const bars = Array.from({ length: 30 }, (_, i) => ({ t: 1000 + i * 300000, c: 100 + i, v: 10 }));
const normalizeSymbol = symbol => symbol.trim().toUpperCase();

test('crypto bars try the next timeframe after a failed request, without changing timestamps', async () => {
  const calls = [];
  const store = createCryptoIntradayBars({ normalizeSymbol, getRecentBars: async (symbol, timeframe, limit) => {
    calls.push([symbol, timeframe, limit]);
    if (timeframe === '5Min') throw new Error('provider unavailable');
    return bars;
  }});
  assert.deepEqual(await store.get(' btc/usd '), bars);
  assert.deepEqual(calls, [['BTC/USD', '5Min', 30], ['BTC/USD', '1Min', 30]]);
  await store.get('BTC/USD');
  assert.equal(calls.length, 2);
});

test('empty crypto history retries after five seconds instead of hiding recovery for two minutes', async () => {
  let time = 1000, calls = 0, recovered = false;
  const store = createCryptoIntradayBars({ normalizeSymbol, now: () => time, getRecentBars: async () => { calls++; return recovered ? bars : []; } });
  assert.deepEqual(await store.get('BTC/USD'), []);
  assert.equal(calls, 3, 'no duplicate fourth request');
  recovered = true;
  time += 4999;
  assert.deepEqual(await store.get('BTC/USD'), []);
  time++;
  assert.deepEqual(await store.get('BTC/USD'), bars);
  assert.equal(calls, 4);
});

test('partial crypto history retains the best actual window and bounds failure caches too', async () => {
  const store = createCryptoIntradayBars({ normalizeSymbol, maxSymbols: 2, getRecentBars: async (_, timeframe) => timeframe === '5Min' ? bars.slice(0, 8) : [] });
  for (const symbol of ['BTC/USD', 'ETH/USD', 'SOL/USD']) assert.deepEqual(await store.get(symbol), bars.slice(0, 8));
  assert.deepEqual(store.getStatus(), { cachedSymbols: 2, pendingSymbols: 0, capacity: 2 });
});

test('concurrent crypto history requests coalesce and pending symbols stay bounded', async () => {
  let finish, calls = 0;
  const store = createCryptoIntradayBars({ normalizeSymbol, maxSymbols: 1, getRecentBars: () => { calls++; return new Promise(resolve => { finish = resolve; }); } });
  const first = store.get('BTC/USD');
  assert.equal(store.get(' btc/usd '), first);
  assert.deepEqual(await store.get('ETH/USD'), []);
  assert.equal(calls, 1);
  finish(bars);
  assert.deepEqual(await first, bars);
  assert.equal(store.getStatus().pendingSymbols, 0);
});
