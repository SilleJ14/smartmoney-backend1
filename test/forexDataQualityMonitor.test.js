import test from "node:test";
import assert from "node:assert/strict";
import { createForexDataQualityMonitor } from "../forex/dataQualityMonitor.js";
import { createForexScheduler } from "../forex/scheduler.js";

test("provider health remains separate from per-pair evidence", () => {
  const monitor = createForexDataQualityMonitor({ nowFn: () => Date.parse("2026-10-02T05:00:00Z") });
  monitor.recordProvider("oanda", { ok: true, connected: true, entitled: true });
  monitor.recordPairEvidence("EUR/USD", {
    quoteAvailable: false,
    spreadAvailable: false,
    candlesAvailable: true,
    contextAvailable: true,
    reasons: ["QUOTE_UNAVAILABLE"],
  });
  const snapshot = monitor.snapshot();
  assert.equal(snapshot.providerHealth.oanda.ok, true);
  assert.equal(snapshot.pairEvidence["EUR/USD"].quoteAvailable, false);
  assert.deepEqual(snapshot.pairEvidence["EUR/USD"].reasons, ["QUOTE_UNAVAILABLE"]);
});

test("latency reports bounded p50 and p95 without accepting malformed values", () => {
  const monitor = createForexDataQualityMonitor();
  for (const value of [10, 20, 30, 40, 100]) monitor.recordLatency("feature", value);
  assert.equal(monitor.recordLatency("feature", "bad"), false);
  const snapshot = monitor.snapshot();
  assert.equal(snapshot.latency.feature.p50Ms, 30);
  assert.equal(snapshot.latency.feature.p95Ms, 100);
  assert.ok(snapshot.recentEvents.some(event => event.type === "MALFORMED_LATENCY"));
});

test("busy scanner coalesces load into one requeued cycle and measures queue wait", async () => {
  let release;
  let scans = 0;
  let clock = 1000;
  const waits = [];
  const scheduler = createForexScheduler({
    now: () => clock,
    onQueueWait: value => waits.push(value),
    scan: () => ++scans === 1
      ? new Promise(resolve => { release = resolve; })
      : Promise.resolve({ cycle: scans }),
    protect: async () => {},
  });
  const first = scheduler.scan();
  const queued = Array.from({ length: 50 }, () => scheduler.scan());
  clock += 75;
  release({ cycle: 1 });
  assert.deepEqual(await first, { cycle: 1 });
  const results = await Promise.all(queued);
  assert.equal(scans, 2);
  assert.ok(results.every(result => result.cycle === 2));
  assert.deepEqual(waits, [75]);
});
