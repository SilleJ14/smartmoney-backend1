import test from 'node:test';
import assert from 'node:assert/strict';
import { compareEntryPolicies } from '../analytics/entryPolicyReplay.js';
const spec = { trainingEnd: 1, evaluationStart: 2000, evaluationEnd: 10000, horizonMs: 1000,
  targetPercent: 5, stopPercent: 2, minimumSample: 10, maximumEarlyMovePercent: 3,
  feePercentPerSide: .1, slippagePercentPerSide: .1 };
const candidate = { symbol: 'TEST', assetClass: 'stock', observations: [
  { at: 2100, bid: 99, ask: 100, setupDetected: true },
  { at: 2200, bid: 101, ask: 102, triggerConfirmed: true },
  { at: 3300, bid: 98, ask: 99 },
] };
test('historical replay records failed setups, charges costs and keeps assets separate', () => {
  const result = compareEntryPolicies([candidate], spec);
  assert.equal(result.outcomes.length, 2);
  assert.ok(result.outcomes.every(r => r.netReturnPercent < 0));
  assert.equal(result.summaries['stock:early_setup'].sampleSufficient, false);
  assert.equal(result.summaries['crypto:early_setup'].completed, 0);
});
test('replay rejects lookahead ordering and absent costs or holdout embargo', () => {
  assert.throws(() => compareEntryPolicies([{ ...candidate, observations: [...candidate.observations].reverse() }], spec), /CHRONOLOGICAL/);
  assert.throws(() => compareEntryPolicies([candidate], { ...spec, feePercentPerSide: undefined }), /COST_REQUIRED/);
  assert.throws(() => compareEntryPolicies([candidate], { ...spec, trainingEnd: 1900 }), /EMBARGO/);
});
test('future observations cannot rewrite an earlier entry; unfinished outcomes are not fabricated wins', () => {
  const result = compareEntryPolicies([{ ...candidate, observations: candidate.observations.slice(0, 2) }], spec);
  assert.ok(result.outcomes.every(r => r.status === 'INCOMPLETE_HORIZON' && r.netReturnPercent === null));
});
