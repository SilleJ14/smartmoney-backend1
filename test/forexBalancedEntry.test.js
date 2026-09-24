import test from 'node:test';
import assert from 'node:assert/strict';
import { FOREX_SPEC } from '../forex/forexSpec.js';
import { entryExpired, chasedAway } from '../forex/strategyExits.js';
const confirmedAt = '2026-09-23T15:00:00Z';
const start = Date.parse(confirmedAt);
test('balanced entry accepts modest scan delay but expires after three minutes', () => {
  for (const seconds of [0, 61, 120, 180]) assert.equal(entryExpired({ confirmedAt, now: start + seconds * 1000 }), false);
  assert.equal(entryExpired({ confirmedAt, now: start + 180001 }), true);
});
test('missing malformed and future confirmations cannot use the extended window', () => {
  for (const value of [undefined, null, '', 'bad', '2026-09-23T15:00:01Z'])
    assert.equal(entryExpired({ confirmedAt: value, now: start }), true);
});
test('longer window does not permit chasing either direction or loosen safety', () => {
  assert.equal(chasedAway({ side: 'buy', confirmationPrice: 100, currentPrice: 100.11, A: 1 }), true);
  assert.equal(chasedAway({ side: 'sell', confirmationPrice: 100, currentPrice: 99.89, A: 1 }), true);
  assert.equal(FOREX_SPEC.maxAdverseEntryAtr, 0.1);
  assert.equal(FOREX_SPEC.quoteProviderMaxAgeSeconds, 2);
  assert.equal(FOREX_SPEC.practiceRiskCapPercent, 10);
  assert.equal(FOREX_SPEC.minNetRewardRisk, 2);
  assert.equal(FOREX_SPEC.liveOrdersAuthorized, false);
});
