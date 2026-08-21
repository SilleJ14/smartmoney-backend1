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
