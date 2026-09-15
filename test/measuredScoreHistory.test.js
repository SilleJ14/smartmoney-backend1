import test from 'node:test';
import assert from 'node:assert/strict';
import { retainMeasuredStockScores } from '../scoring/measuredScoreHistory.js';
test('each measured component survives independently without granting current availability', () => {
  const now = Date.now(), at = new Date(now).toISOString();
  const first = retainMeasuredStockScores({ symbol: 'AAPL', decisionUpdatedAt: at,
    discoveryScore: 80, discoveryScoreAvailable: true, entryQualityScore: 77, entryQualityScoreAvailable: true,
    stockDecisionScore: 79, stockDecisionScoreAvailable: true, multiDayScore: 82, multiDayScoreAvailable: true }, {}, now);
  const next = retainMeasuredStockScores({ symbol: 'AAPL', decisionUpdatedAt: at,
    discoveryScore: 81, discoveryScoreAvailable: true, entryQualityScoreAvailable: false,
    stockDecisionScoreAvailable: false, multiDayScoreAvailable: false }, first, now);
  assert.equal(next.measuredScoreHistory.discovery.value, 81);
  assert.equal(next.measuredScoreHistory.entry.value, 77);
  assert.equal(next.measuredScoreHistory.final.value, 79);
  assert.equal(next.measuredScoreHistory.continuation.value, 82);
  assert.equal(next.stockDecisionScoreAvailable, false);
  assert.equal(next.approved, undefined);
  const restored = JSON.parse(JSON.stringify(next));
  assert.deepEqual(retainMeasuredStockScores({ symbol: 'AAPL' }, restored, now + 86400000).measuredScoreHistory, next.measuredScoreHistory);
});
test('missing, stale and fabricated component values are not retained', () => {
  const result = retainMeasuredStockScores({symbol: 'AAPL', decisionUpdatedAt: '2000-01-01', stockDecisionScore: 88, stockDecisionScoreAvailable: true});
  assert.deepEqual(result.measuredScoreHistory, {});
  assert.equal(retainMeasuredStockScores({symbol: 'BTC/USD'}).measuredScoreHistory, undefined);
});
