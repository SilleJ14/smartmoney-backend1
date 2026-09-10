import test from 'node:test';
import assert from 'node:assert/strict';
import { quietDiscoverySessionDay } from '../discovery/quietDiscoverySession.js';
test('premarket, open and restarts use a completed session across weekends and holidays', () => {
  for (const hour of [4, 8, 10, 15]) assert.equal(quietDiscoverySessionDay('2026-09-08', hour, 0), '2026-09-04');
  assert.equal(quietDiscoverySessionDay('2026-09-08', 16, 9), '2026-09-04');
  assert.equal(quietDiscoverySessionDay('2026-09-08', 16, 10), '2026-09-08');
  assert.equal(quietDiscoverySessionDay('2026-09-12', 17, 0), '2026-09-11');
  assert.equal(quietDiscoverySessionDay('bad', 8, 0), null);
});
