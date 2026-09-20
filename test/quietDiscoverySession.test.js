import test from 'node:test';
import assert from 'node:assert/strict';
import { quietDiscoverySessionDay, shouldReuseQuietDiscoveryState } from '../discovery/quietDiscoverySession.js';
test('premarket, open and restarts use a completed session across weekends and holidays', () => {
  for (const hour of [4, 8, 10, 15]) assert.equal(quietDiscoverySessionDay('2026-09-08', hour, 0), '2026-09-04');
  assert.equal(quietDiscoverySessionDay('2026-09-08', 16, 9), '2026-09-04');
  assert.equal(quietDiscoverySessionDay('2026-09-08', 16, 10), '2026-09-08');
  assert.equal(quietDiscoverySessionDay('2026-09-12', 17, 0), '2026-09-11');
  assert.equal(quietDiscoverySessionDay('bad', 8, 0), null);
});
test('forced quiet discovery does not reuse a completed session cache', () => {
  const prior = { ok: true, dateKey: '2026-09-08', updatedAt: '2026-09-08T21:00:00.000Z', historicalWarmupRemaining: 0 };
  assert.equal(shouldReuseQuietDiscoveryState(prior, { dateKey: '2026-09-08' }), true);
  assert.equal(shouldReuseQuietDiscoveryState(prior, { dateKey: '2026-09-08', force: true }), false);
});
