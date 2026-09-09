import test from "node:test";
import assert from "node:assert/strict";
import { createTaskScheduler } from "../engine/taskScheduler.js";
test("prevents overlapping task execution", async () => {
  let release;
  const scheduler = createTaskScheduler({ now: () => 1000 });
  const first = scheduler.run("scan", 100, () => new Promise((resolve) => { release = resolve; }));
  assert.equal((await scheduler.run("scan", 100, async () => {})).reason, "locked");
  release();
  await first;
});
test("honors task intervals", async () => {
  let now = 1000;
  let count = 0;
  const scheduler = createTaskScheduler({ now: () => now });
  await scheduler.run("scan", 100, async () => { count += 1; });
  assert.equal((await scheduler.run("scan", 100, async () => { count += 1; })).reason, "interval");
  now = 1100;
  await scheduler.run("scan", 100, async () => { count += 1; });
  assert.equal(count, 2);
});
test("reports failures and releases locks", async () => {
  const errors = [];
  const scheduler = createTaskScheduler({ now: () => 1000, onError: (...args) => errors.push(args) });
  const result = await scheduler.run("scan", 100, async () => { throw new Error("boom"); });
  assert.equal(result.reason, "failed");
  assert.equal(scheduler.isLocked("scan"), false);
  assert.equal(errors.length, 1);
});

for (const asynchronous of [false, true]) test(`a ${asynchronous ? 'rejected' : 'throwing'} error reporter cannot reject a fire-and-forget job`, async () => {
  let now = 10000;
  const workerError = new Error('outcome storage unavailable');
  const reporterError = new Error('diagnostic write unavailable');
  const scheduler = createTaskScheduler({ now: () => now, onError: () => {
    if (asynchronous) return Promise.reject(reporterError);
    throw reporterError;
  } });
  const result = await scheduler.run('runner', 2000, () => { throw workerError; });
  assert.equal(result.reason, 'failed');
  assert.equal(result.error, workerError);
  assert.equal(result.reportingError, reporterError);
  assert.equal(scheduler.isLocked('runner'), false);
  now += 2000;
  assert.equal((await scheduler.run('runner', 2000, () => {})).reason, 'completed');
});

test('hundreds of feed triggers share one slow runner and a single later recovery', async () => {
  let now = 10000, calls = 0, release;
  const scheduler = createTaskScheduler({ now: () => now });
  const work = () => { calls++; return new Promise(resolve => { release = resolve; }); };
  const first = scheduler.run('runner', 2000, work);
  const burst = await Promise.all(Array.from({ length: 600 }, () => scheduler.run('runner', 2000, work)));
  assert.ok(burst.every(result => result.reason === 'locked'));
  assert.equal(calls, 1);
  release();
  await first;
  now += 2000;
  const later = scheduler.run('runner', 2000, work);
  release();
  assert.equal((await later).reason, 'completed');
  assert.equal(calls, 2);
});
