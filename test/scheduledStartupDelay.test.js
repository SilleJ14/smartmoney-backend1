import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createTaskScheduler } from '../engine/taskScheduler.js';

test('heavy scheduled scans are not called during boot, so their first run is not pushed back a whole interval', () => {
  const source = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /process\.uptime\(\) < 20 \? undefined/, 'a no-op inside the scheduler consumes the interval slot');
  const guarded = source.slice(source.indexOf('if (process.uptime() >= 20) {'));
  for (const task of ['runDeepIntelligenceSync', 'runBoundedQuietDiscoveryScan', 'runMainSwingScan']) {
    assert.ok(guarded.indexOf(`"${task}"`) > 0 && guarded.indexOf(`"${task}"`) < guarded.indexOf('}, 1000);'), task);
  }
});

test('the scheduler records a run even when the worker does nothing (why the guard sits outside it)', async () => {
  let clock = 0;
  const scheduler = createTaskScheduler({ now: () => clock });
  await scheduler.run('scan', 300000, () => undefined);
  clock = 30000;
  assert.equal((await scheduler.run('scan', 300000, () => undefined)).reason, 'interval');
});
