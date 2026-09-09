import test from 'node:test';
import assert from 'node:assert/strict';
import { getCompletedUniqueStockSessionDays } from '../scoring/decisionScores.js';

test('continuation reuses timezone formatting without freezing the current session', () => {
  const original = Intl.DateTimeFormat;
  let constructions = 0;
  Intl.DateTimeFormat = function (...args) { constructions++; return new original(...args); };
  try {
    for (let index = 0; index < 1000; index++) {
      const days = ['2026-09-04', '2026-09-08'];
      assert.deepEqual(getCompletedUniqueStockSessionDays(days, { now: Date.parse('2026-09-09T03:30:00Z') }), ['2026-09-04']);
      assert.deepEqual(getCompletedUniqueStockSessionDays(days, { now: Date.parse('2026-09-09T04:00:00Z') }), days);
    }
    assert.equal(constructions, 0, 'live score refreshes must not repeatedly initialize ICU');
  } finally { Intl.DateTimeFormat = original; }
});

test('completed sessions keep their winter and post-DST New York day boundaries', () => {
  for (const [days, before, after] of [
    [['2026-01-05', '2026-01-06'], '2026-01-07T04:59:00Z', '2026-01-07T05:00:00Z'],
    [['2026-03-06', '2026-03-09'], '2026-03-10T03:59:00Z', '2026-03-10T04:00:00Z'],
  ]) {
    assert.deepEqual(getCompletedUniqueStockSessionDays(days, { now: Date.parse(before) }), [days[0]]);
    assert.deepEqual(getCompletedUniqueStockSessionDays(days, { now: Date.parse(after) }), days);
  }
});
