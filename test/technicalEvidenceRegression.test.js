import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Execute only these pure functions from production source, never boot the server.
const source = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
const start = source.indexOf('function computeEma('), end = source.indexOf('async function getCryptoAssets()', start);
assert.ok(start > 0 && end > start);
const { computeRsi, computeMacd, computeTechnicals } = new Function(
  source.slice(start, end) + '; return { computeRsi, computeMacd, computeTechnicals };'
)();

test('RSI uses latest candles, not only the first fourteen changes', () => {
  const initial = Array.from({ length: 15 }, (_, i) => 100 + i);
  const rising = initial.concat(Array.from({ length: 15 }, (_, i) => 115 + i));
  const falling = initial.concat(Array.from({ length: 15 }, (_, i) => 113 - i));
  assert.equal(computeRsi(rising), 100);
  assert.ok(computeRsi(falling) < 40);
  assert.equal(computeRsi(Array(60).fill(100)), 50);
});

test('MACD requires real signal history, and actual quote paths request enough candles', () => {
  assert.equal(computeMacd(Array(30).fill(100)).signal, null);
  const values = Array.from({ length: 60 }, (_, i) => 100 + i * 0.2 + Math.sin(i) * 2);
  const macd = computeMacd(values);
  assert.ok(Number.isFinite(macd.signal));
  assert.notEqual(macd.signal, macd.macd * 0.8);
  assert.match(source, /getRecentBars\(symbol, "5Min", 60\)/);
  assert.match(source, /getRecentBars\(q.symbol, "5Min", 60\)/);
});

test('technical evidence supports provider and normalized candles without dropping malformed closes', () => {
  const values = Array.from({ length: 60 }, (_, i) => 100 + i * 0.1);
  assert.deepEqual(computeTechnicals(values.map(c => ({ c }))), computeTechnicals(values.map(close => ({ close }))));
  for (const invalid of [null, {}, { c: 0 }, { c: NaN }, { c: -1 }]) {
    const bars = values.map(c => ({ c })); bars[40] = invalid;
    assert.deepEqual(computeTechnicals(bars), { ema9: null, ema20: null, rsi: null, macd: null, macdSignal: null });
  }
});
