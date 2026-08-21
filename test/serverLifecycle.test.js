import test from "node:test";
import assert from "node:assert/strict";
import { startServerLifecycle } from "../bootstrap/serverLifecycle.js";

test("starts services and schedules maintenance from one lifecycle boundary", async () => {
  const handlers = {}, intervals = [], started = [];
  const app = { listen: (_port, _host, callback) => { callback(); return "server"; } };
  const result = startServerLifecycle({
    app, port: 3000, processRef: { on: (name, fn) => { handlers[name] = fn; }, exit: () => {} },
    state: {}, config: {}, autoTradingEnabled: false, runStartupEngineScan: false,
    runStartupScan: async () => {}, saveState: () => {}, flushState: async () => {},
    saveRenderMemory: () => {}, checkRunnerResults: async () => {},
    startServices: [() => started.push("feed")],
    setIntervalFn: (fn, ms) => intervals.push({ fn, ms }), logger: { log() {}, error() {} },
  });
  await Promise.resolve();
  assert.equal(result, "server");
  assert.deepEqual(started, ["feed"]);
  assert.equal(intervals.length, 2);
  assert.equal(typeof handlers.SIGTERM, "function");
});
