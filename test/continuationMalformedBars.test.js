import test from 'node:test';
import assert from 'node:assert/strict';
import { hydrateCryptoContinuationMemoryFromDailyBars } from '../scoring/cryptoScoring.js';

test('malformed daily history cannot crash continuation hydration or invent evidence', () => {
  for (const bars of [null, {}, [null], [false, [], 'bad'], [{ t: 1e100 }], [{ t: '2026-01-01', c: 100 }]]) {
    const result = hydrateCryptoContinuationMemoryFromDailyBars(null, bars);
    assert.equal(result.available, false);
    assert.equal(result.historicalDailyBarsHydrated, 0);
    assert.ok(result.historicalDailyBarsRejected > 0);
    assert.equal(result.historicalDailyBarsEvidenceReason, 'INVALID_HISTORICAL_BARS_EXCLUDED');
    assert.equal(result.drawdownBasis, 'close-to-close');
    assert.equal(result.scoringSessionCount, 0);
  }
});
