import test from 'node:test';
import assert from 'node:assert/strict';
import { detectMemoryBudget, buildMemoryGuardSnapshot } from '../state/memoryGuard.js';

const missing = () => { throw new Error('unavailable'); };
test('container limit wins over an erroneously configured 2 GB budget', () => {
  const budget = detectMemoryBudget({ configured: 2048, constrained: 0,
    read: path => path.endsWith('memory.max') ? String(512 * 1048576) : 'max' });
  assert.deepEqual(budget, { limitMb: 512, limitSource: 'cgroup' });
});
test('v1 unlimited sentinel is ignored and unknown hosts default to 512 MB', () => {
  assert.deepEqual(detectMemoryBudget({ configured: '', constrained: 0,
    read: path => path.endsWith('memory.max') ? 'max' : '9223372036854771712' }),
  { limitMb: 512, limitSource: 'conservative-fallback' });
});
test('uses constrained memory and honors a smaller configured budget', () => {
  assert.equal(detectMemoryBudget({ configured: 2048, constrained: 512 * 1048576, read: missing }).limitMb, 512);
  assert.equal(detectMemoryBudget({ configured: 384, constrained: 512 * 1048576, read: missing }).limitMb, 384);
});
test('malformed configuration cannot disable pressure detection', () => {
  assert.equal(detectMemoryBudget({ configured: 'NaN', constrained: 0, read: missing }).limitMb, 512);
  const status = buildMemoryGuardSnapshot({ rss: 450 * 1048576 }, { limitMb: 512, softRatio: NaN, hardRatio: 4 });
  assert.equal(status.pressure, 'critical');
  assert.equal(status.shouldPauseHeavyWork, true);
  assert.ok(status.heapLimitMb > 0);
});
test('small real limits are never rounded up and healthy usage permits discovery', () => {
  assert.equal(buildMemoryGuardSnapshot({ rss: 120 * 1048576 }, { limitMb: 128 }).pressure, 'critical');
  assert.equal(buildMemoryGuardSnapshot({ rss: 300 * 1048576 }, { limitMb: 512 }).shouldPauseHeavyWork, false);
});
