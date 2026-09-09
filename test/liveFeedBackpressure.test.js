import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createTaskScheduler } from '../engine/taskScheduler.js';
import { createDiscoveryOutcomeStore } from '../scoring/discoveryOutcomeStore.js';

test('200 feed and timer requests share one scan; the next pass sees the newest quote', async () => {
  let now = 10000, release, calls = 0, latestPrice = 100;
  const observed = [];
  const scheduler = createTaskScheduler({ now: () => now });
  const work = async () => {
    calls++;
    await new Promise(resolve => { release = resolve; });
    observed.push(latestPrice);
  };
  const first = scheduler.run('runFastRunnerEngine', 2000, work);
  const burst = Array.from({ length: 200 }, (_, i) => {
    latestPrice = 101 + i;
    return scheduler.run('runFastRunnerEngine', 2000, work);
  });
  assert.ok((await Promise.all(burst)).every(result => result.reason === 'locked'));
  assert.equal(calls, 1);
  release();
  await first;
  assert.deepEqual(observed, [300]);
  assert.equal((await scheduler.run('runFastRunnerEngine', 2000, work)).reason, 'interval');
  now += 2000;
  latestPrice = 301;
  const next = scheduler.run('runFastRunnerEngine', 2000, work);
  release();
  await next;
  assert.deepEqual(observed, [300, 301]);
});

test('storage and reporting failures are observable results, not uncaught timer rejections', async () => {
  const error = new Error('Outcome storage queue full; retry required');
  const reportError = new Error('Diagnostic storage unavailable');
  let now = 10000;
  const scheduler = createTaskScheduler({ now: () => now, onError() { throw reportError; } });
  const result = await scheduler.run('runFastRunnerEngine', 2000, () => { throw error; });
  assert.equal(result.reason, 'failed');
  assert.equal(result.error, error);
  assert.equal(result.reportingError, reportError);
  assert.equal(scheduler.isLocked('runFastRunnerEngine'), false);
  now += 2000;
  assert.equal((await scheduler.run('runFastRunnerEngine', 2000, async () => {})).reason, 'completed');
});

test('outcome queue stays bounded, reports overload, drains and accepts later work', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'smartmoney-outcome-pressure-'));
  try {
    const store = createDiscoveryOutcomeStore(directory);
    const tasks = Array.from({ length: 70 }, () => store.ingest([], [], {
      assetClass: 'stock', dayKey: '2026-09-09', now: Date.parse('2026-09-09T15:00:00Z'),
    }));
    const results = await Promise.allSettled(tasks);
    const rejected = results.filter(result => result.status === 'rejected');
    assert.equal(rejected.length, 6);
    assert.ok(rejected.every(result => result.reason.code === 'OUTCOME_STORAGE_BACKPRESSURE'));
    assert.deepEqual(store.getStatus(), { pending: 0, peakPending: 64, queueLimit: 64, rejected: 6, completed: 64, failed: 0 });
    await store.ingest([], [], { assetClass: 'crypto', dayKey: '2026-09-09' });
    assert.equal(store.getStatus().completed, 65);
    assert.equal(store.getStatus().pending, 0);
  } finally {
    // Exact temporary test directory only, never application state.
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('a failed outcome write does not poison later queued work', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'smartmoney-outcome-recovery-'));
  try {
    const store = createDiscoveryOutcomeStore(directory);
    await assert.rejects(store.ingest([], [], { assetClass: 'invalid', dayKey: '2026-09-09' }), /Invalid discovery cohort/);
    await store.ingest([], [], { assetClass: 'stock', dayKey: '2026-09-09' });
    assert.equal(store.getStatus().failed, 1);
    assert.equal(store.getStatus().completed, 1);
    assert.equal(store.getStatus().pending, 0);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
