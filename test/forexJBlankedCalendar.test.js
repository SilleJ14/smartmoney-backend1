import test from "node:test";
import assert from "node:assert/strict";
import { createEconomicCalendarProvider, normalizeJBlankedCalendar } from "../forex/economicCalendarProvider.js";
import { createMemoryStore } from "../forex/durableStore.js";

const START = Date.parse("2026-09-23T10:00:00Z");
const DAY = 86400000;
const rows = [{ Name: "CPI", Currency: "USD", Impact: "High", Date: "2026.09.24 15:30:00" }];
const options = () => ({ provider: "jblanked", jblankedApiKey: "test-secret",
  store: createMemoryStore({ treatAsDurable: true }), nowFn: () => START,
  fetchImpl: async () => new Response(JSON.stringify(rows)) });

test("JBlanked converts GMT+3 and bounds coverage to the current week", () => {
  const s = normalizeJBlankedCalendar(rows, START);
  assert.equal(s.events[0].start, "2026-09-24T12:30:00.000Z");
  assert.equal(s.coveredFrom, "2026-09-20T22:00:00.000Z");
  assert.equal(s.coveredThrough, "2026-09-26T03:59:00.000Z");
  for (const invalid of [[], {}, [null], [{ ...rows[0], Date: "Tentative" }], [{ ...rows[0], Date: "2026.02.30 12:00:00" }]]) {
    assert.throws(() => normalizeJBlankedCalendar(invalid, START));
  }
});

test("daily quota survives provider recreation and concurrent calls; cached time does not advance", async () => {
  let now = START, calls = 0;
  const config = { ...options(), nowFn: () => now, fetchImpl: async (url, init) => {
    calls++;
    assert.equal(init.headers.Authorization, "Api-Key test-secret");
    assert.ok(!url.includes("test-secret"));
    return new Response(JSON.stringify(rows));
  } };
  const a = createEconomicCalendarProvider(config), b = createEconomicCalendarProvider(config);
  await Promise.all([a.refresh(), a.refresh(), b.refresh()]);
  assert.equal(calls, 1);
  assert.equal(a.getSnapshot().coverageComplete, true);
  now += 16 * 60000;
  const restarted = createEconomicCalendarProvider(config);
  await restarted.refresh();
  assert.equal(calls, 1);
  assert.equal(restarted.getStatus().lastSuccessAt, new Date(START).toISOString());
  assert.equal(restarted.getSnapshot().coverageComplete, false);
  assert.match(restarted.getStatus().limitation, /Daily snapshot/);
  assert.ok(!JSON.stringify(await config.store.load()).includes("test-secret"));
  now = START + DAY;
  await restarted.refresh();
  assert.equal(calls, 2);
});

test("provider failures consume quota and redact provider bodies", async () => {
  for (const http of [401, 403, 429, 500]) {
    let calls = 0;
    const config = { ...options(), fetchImpl: async () => {
      calls++; return new Response("test-secret", { status: http });
    } };
    const a = createEconomicCalendarProvider(config);
    await a.refresh();
    const b = createEconomicCalendarProvider(config);
    await b.refresh();
    assert.equal(calls, 1);
    assert.equal(b.getSnapshot().coverageComplete, false);
    assert.ok(!JSON.stringify(b.getStatus()).includes("test-secret"));
  }
});

test("missing durable storage or credentials cannot consume an API request", async () => {
  for (const overrides of [{ store: createMemoryStore() }, { jblankedApiKey: "" }]) {
    let calls = 0;
    const p = createEconomicCalendarProvider({ ...options(), ...overrides, fetchImpl: async () => { calls++; } });
    await p.refresh();
    assert.equal(calls, 0);
    assert.equal(p.getSnapshot().coverageComplete, false);
  }
});

test("a failed cache write never publishes usable evidence", async () => {
  const config = options();
  const original = config.store.commit.bind(config.store);
  let writes = 0;
  config.store.commit = fn => ++writes > 1 ? Promise.reject(new Error("disk failed")) : original(fn);
  const p = createEconomicCalendarProvider(config);
  await p.refresh();
  assert.equal(p.getStatus().error, "CALENDAR_CACHE_WRITE_FAILED");
  assert.equal(p.getSnapshot().coverageComplete, false);
});

test("429 Retry-After can extend but never shorten the daily cooldown", async () => {
  const p = createEconomicCalendarProvider({ ...options(), fetchImpl: async () => new Response("", {
    status: 429, headers: { "retry-after": "172800" },
  }) });
  await p.refresh();
  assert.equal(Date.parse(p.getStatus().nextAttemptAt), START + 2 * DAY);
});
