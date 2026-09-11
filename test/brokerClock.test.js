import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrokerClock, clockSnapshot } from '../market-data/brokerClock.js';
import { createAlpacaClient } from '../execution/alpacaClient.js';

test('coalesces clock requests and refreshes independently of long scans', async () => {
  let now = Date.now(), count = 0;
  const clock = createBrokerClock({ now: () => now, request: async () => {
    count++; return { is_open: true, timestamp: new Date(now).toISOString() };
  } });
  const values = await Promise.all(Array.from({ length: 30 }, () => clock.get()));
  assert.equal(count, 1); assert.ok(values.every(x => x.is_open));
  now += 15001; await clock.get(); assert.equal(count, 2);
  now += 60001; assert.equal(clock.snapshot().available, false);
});
test('clock retry is bounded and failure never invents provider time or market closure', async () => {
  let now = Date.now(), calls = 0, fail = false;
  const clock = createBrokerClock({ now: () => now, retryDelay: async () => {}, request: async () => {
    calls++; if (fail) throw new Error('HTTP 500');
    return { is_open: true, timestamp: new Date(now).toISOString() };
  } });
  const good = await clock.get(); fail = true; now += 15001;
  const bad = await clock.get(); assert.equal(calls, 3);
  assert.equal(bad.available, false); assert.equal(bad.is_open, false);
  assert.equal(bad.timestamp, good.timestamp);
  await clock.get(); assert.equal(calls, 3);
  now += 5001; fail = false; assert.equal((await clock.get()).available, true);
});
test('malformed, stale, future and authorization failures cannot grant market permission', async () => {
  const now = Date.now();
  for (const value of [null, {}, { is_open: 'true', timestamp: new Date(now).toISOString() },
    { is_open: true, timestamp: new Date(now + 6000).toISOString() },
    { is_open: true, timestamp: new Date(now - 60001).toISOString() }]) assert.equal(clockSnapshot(value, now).available, false);
  let calls = 0;
  const clock = createBrokerClock({ request: async () => { calls++; throw Object.assign(new Error('Unauthorized'), { status: 401 }); } });
  assert.equal((await clock.get()).available, false); assert.equal(calls, 1);
});
test('clock HTTP failure does not poison order/account health or cooldown', async () => {
  const failures = [], health = [];
  const client = createAlpacaClient({ getKeys: () => ({}), getTradingBaseUrl: () => 'https://fixture',
    fetchWithTimeout: async () => ({ ok: false, status: 500, text: async () => '{"message":"Internal Server Error"}' }),
    onTradingFailure: x => failures.push(x), onApiHealth: (...x) => health.push(x) });
  await assert.rejects(client.tradingRequest('/v2/clock'));
  assert.equal(failures.length, 0); assert.equal(health[0][0], 'alpacaClock');
});
