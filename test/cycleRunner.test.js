import test from "node:test";
import assert from "node:assert/strict";
import { createCycleRunner } from "../engine/cycleRunner.js";

test("cycle runner owns successful tick lifecycle", async () => {
  let timestamp = 1000;
  const state = {};
  const saves = [];
  const runner = createCycleRunner({ state, saveState: (reason) => saves.push(reason), now: () => timestamp });
  const result = await runner.run(async () => { timestamp = 1042; });
  assert.deepEqual(result, { ran: true, reason: "completed" });
  assert.equal(state.running, false);
  assert.equal(state.totalEngineTicks, 1);
  assert.equal(state.lastTickDurationMs, 42);
  assert.deepEqual(saves, ["ENGINE_TICK_COMPLETED"]);
});

test("cycle runner records failures and always releases its lock", async () => {
  const state = { selfHealingScanHistory: [] };
  const saves = [];
  const runner = createCycleRunner({ state, saveState: (reason) => saves.push(reason), onError: () => {} });
  const result = await runner.run(async () => { throw new Error("feed unavailable"); });
  assert.equal(result.reason, "failed");
  assert.equal(state.running, false);
  assert.equal(state.lastError, "feed unavailable");
  assert.equal(state.selfHealingScanHistory.length, 1);
  assert.deepEqual(saves, ["ENGINE_ERROR"]);
});

test("cycle runner rejects overlapping ticks", async () => {
  const state = { running: true };
  const runner = createCycleRunner({ state, saveState: () => {} });
  assert.deepEqual(await runner.run(async () => {}), { ran: false, reason: "already_running" });
});

test('scan dispositions include skipped, failed and completed cycles without leaking errors', async () => {
  const events = [], state = { running: true };
  const runner = createCycleRunner({ state, saveState: () => {}, onError: () => {}, onScanEvent: e => events.push(e) });
  await runner.run(async () => {});
  state.running = false;
  await runner.run(async () => { throw new Error('sensitive provider error'); });
  await runner.run(async () => {});
  assert.deepEqual(events.map(e => e.stage), ['SCAN_SKIPPED', 'SCAN_STARTED', 'SCAN_FAILED', 'SCAN_STARTED', 'SCAN_COMPLETED']);
  assert.ok(!JSON.stringify(events).includes('sensitive'));
});

test('failed persistence releases the cycle lock and records failure, never completion', async () => {
  const state = {}, events = [];
  const runner = createCycleRunner({ state, saveState: async () => { throw new Error('disk unavailable'); }, onScanEvent: e => events.push(e) });
  await assert.rejects(runner.run(async () => {}), /disk unavailable/);
  assert.equal(state.running, false);
  assert.deepEqual(events.map(e => e.stage), ['SCAN_STARTED', 'SCAN_PERSISTENCE_FAILED']);
});
