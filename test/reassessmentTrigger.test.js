import test from 'node:test';
import assert from 'node:assert/strict';
import { reassessmentTrigger } from '../discovery/reassessmentTrigger.js';
test('stock and crypto triggers prioritize evidence changes without changing permission', () => {
  for (const symbol of ['AAPL', 'BTC/USD']) {
    const row = reassessmentTrigger({symbol, price:103, decisionReferencePrice:100, approved:false});
    assert.match(row.reassessmentEvent, /^price:/);
    assert.equal(row.approved, false);
    assert.equal(row.reassessmentPriority, 2);
  }
  assert.equal(reassessmentTrigger('AAPL'), 'AAPL');
  assert.equal(reassessmentTrigger({symbol:'AAPL',price:100.1,decisionReferencePrice:100}).reassessmentEvent, undefined);
});
