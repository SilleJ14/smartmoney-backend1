import test from 'node:test';
import assert from 'node:assert/strict';
import { stockHistoryRequest, validCompletedStockBars, createStockHistory } from '../market-data/stockHistory.js';
const now = Date.now();
const bars = (n, step = 300000) => Array.from({ length: n }, (_, i) => ({ t: now - (n - i + 1) * step, o: 10, h: 11, l: 9, c: 10, v: 100 }));
test('Polygon requests enough base minutes for 60 complete five-minute bars', () => {
  const spec = stockHistoryRequest('5Min', 60);
  assert.equal(spec.providerLimit, 310); assert.equal(spec.outputLimit, 62);
  assert.equal(stockHistoryRequest('15Min', 30).providerLimit, 480);
  assert.equal(stockHistoryRequest('1Day', 25).providerLimit, 27);
});
test('preserves the best complete provider history if fallback fails or is shorter', async () => {
  for (const fallback of [async () => { throw new Error('offline'); }, async () => bars(3)]) {
    const reader = createStockHistory({ polygon: async () => bars(21, 86400000), alpaca: fallback, now: () => now });
    assert.equal((await reader.get('AAPL', '1Day', 25)).length, 21);
  }
});
test('coalesces concurrent history requests and caches incomplete results briefly', async () => {
  let count = 0, time = now;
  const reader = createStockHistory({ now: () => time, polygon: async () => { count++; return bars(4); } });
  await Promise.all(Array.from({ length: 15 }, () => reader.get('AAPL')));
  assert.equal(count, 1); await reader.get('AAPL'); assert.equal(count, 1);
  time += 15001; await reader.get('AAPL'); assert.equal(count, 2);
});
test('rejects current incomplete candles, missing volume, invalid OHLC and duplicates', () => {
  const good = bars(3);
  const rows = [...good, good[0], { ...good[0], t: now }, { ...good[0], t: now - 1, v: undefined }, { ...good[0], t: now - 800000, h: 8 }];
  assert.equal(validCompletedStockBars(rows, stockHistoryRequest(), now).length, 3);
});
