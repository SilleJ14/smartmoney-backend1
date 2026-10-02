import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { createOandaClient, createChunkedLineParser, oandaReconnectDelay } from "../forex/oandaClient.js";
import { createFredProvider } from "../forex/providers/fred.js";
import { createCftcTffProvider } from "../forex/providers/cftcTff.js";
import { createCmeDelayedProvider, parseCmeDelayedCsv } from "../forex/providers/cmeDelayed.js";
import { createFinnhubMacroProvider } from "../forex/providers/finnhubMacro.js";
import { createEvidenceSnapshot, verifyEvidenceSnapshot } from "../forex/evidenceSnapshot.js";
import { createJournalStore } from "../forex/journalStore.js";
import { createOandaStreamSupervisor } from "../forex/oandaStreamSupervisor.js";

function response(body, { status = 200, url = "https://provider.test/data" } = {}) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    url,
    headers: { get: () => String(Buffer.byteLength(text)) },
    text: async () => text,
  };
}

test("chunked OANDA lines parse boundaries and reject malformed/oversized data", () => {
  const parser = createChunkedLineParser({ maxLineBytes: 30 });
  assert.deepEqual(parser.push('{"type":"PRI'), []);
  assert.deepEqual(parser.push('CE"}\n\n{"type":"HEARTBEAT"}\n'), [{ type: "PRICE" }, { type: "HEARTBEAT" }]);
  assert.throws(() => createChunkedLineParser().push("{bad}\n"), /MALFORMED/);
  assert.throws(() => createChunkedLineParser({ maxLineBytes: 2 }).push("abc"), /TOO_LARGE/);
  assert.equal(oandaReconnectDelay(10, { baseMs: 100, maxMs: 1000 }), 1000);
});

test("OANDA streams practice only; candles remain generic and orders replace/cancel", async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).includes("/stream")) {
      return { ok: true, status: 200, body: (async function* () {
        yield Buffer.from('{"type":"PRICE"}\n{"type":"HEART');
        yield Buffer.from('BEAT"}\n');
      }()) };
    }
    return response({});
  };
  const client = createOandaClient({ accountId: "practice-1", token: "token", fetchImpl });
  const streamed = [];
  for await (const row of client.streamPrices(["EUR_USD"])) streamed.push(row);
  assert.deepEqual(streamed, [{ type: "PRICE" }, { type: "HEARTBEAT" }]);
  await client.getCandles("EUR_USD", { granularity: "S5", count: 2 });
  await client.getCandles("EUR_USD", { granularity: "M5", count: 3 });
  await client.replaceOrder("7", { type: "LIMIT", price: "1.1" });
  await client.cancelOrder("7");
  assert.ok(calls.some((call) => call.url.includes("granularity=S5")));
  assert.ok(calls.some((call) => call.url.includes("granularity=M5")));
  assert.ok(calls.some((call) => call.url.endsWith("/orders/7/cancel")));

  const live = createOandaClient({
    accountId: "live-1", token: "token", fetchImpl,
    baseUrl: "https://api-fxtrade.oanda.com",
    streamBaseUrl: "https://stream-fxtrade.oanda.com",
  });
  await assert.rejects(live.streamPrices(["EUR_USD"]).next(), /LIVE_FOREX_STREAM/);
  await assert.rejects(live.cancelOrder("7"), /LIVE_FOREX_ORDERS/);
});

test("official/free providers normalize nulls, provenance, stale and malformed states", async () => {
  const now = Date.parse("2026-10-02T00:00:00Z");
  const fred = createFredProvider({
    now: () => now,
    fetchImpl: async (url) => {
      assert.match(String(url), /realtime_start=2026-09-01/);
      return response({ observations: [{ date: "2026-10-01", value: ".", realtime_start: "2026-09-01", realtime_end: "2026-09-01" }] });
    },
  });
  const fredResult = await fred.observations("DFF", { vintageDate: "2026-09-01" });
  assert.equal(fredResult.state, "FRESH");
  assert.equal(fredResult.observations[0].value, null);
  assert.equal(fredResult.provenance.vintageAt, "2026-09-01");

  const cftc = createCftcTffProvider({
    now: () => now,
    maxAgeMs: 1000,
    fetchImpl: async () => response([{ report_date_as_yyyy_mm_dd: "2026-09-01", market_and_exchange_names: "EURO FX", open_interest_all: "" }]),
  });
  const cftcResult = await cftc.observations();
  assert.equal(cftcResult.state, "STALE");
  assert.equal(cftcResult.observations[0].openInterest, null);

  const malformed = createFredProvider({ fetchImpl: async () => response({ no: "rows" }) });
  assert.equal((await malformed.observations("DFF", { vintageDate: "2026-09-01" })).state, "MALFORMED");
  const missing = createFredProvider({ fetchImpl: async () => response({ observations: [] }) });
  assert.equal((await missing.observations("DFF", { vintageDate: "2026-09-01" })).state, "MISSING");
  const timeout = createFredProvider({ timeoutMs: 5, fetchImpl: async () => new Promise(() => {}) });
  assert.equal((await timeout.observations("DFF", { vintageDate: "2026-09-01" })).state, "UNAVAILABLE");
});

test("CME and Finnhub adapters preserve actual/estimate/previous null semantics", async () => {
  const csv = "symbol,timestamp,last,volume\n6E,2026-10-02T00:00:00Z,1.17,\n";
  assert.equal(parseCmeDelayedCsv(csv)[0].volume, null);
  const cme = createCmeDelayedProvider({
    endpoint: "https://cme.test/delayed.csv",
    now: () => Date.parse("2026-10-02T00:01:00Z"),
    fetchImpl: async () => response(csv),
  });
  assert.equal((await cme.observations()).state, "FRESH");

  const finnhub = createFinnhubMacroProvider({
    now: () => Date.parse("2026-10-02T01:00:00Z"),
    fetchImpl: async () => response({ economicCalendar: [{
      event: "Payrolls", country: "US", time: Date.parse("2026-10-02T00:00:00Z") / 1000,
      actual: 0, estimate: null, prev: "12",
    }] }),
  });
  const result = await finnhub.observations({ from: "2026-10-01", to: "2026-10-03" });
  assert.equal(result.observations[0].actual, 0);
  assert.equal(result.observations[0].estimate, null);
  assert.equal(result.observations[0].previous, 12);
});

test("canonical evidence is immutable, stable, verifiable, and preserves null", () => {
  const provider = {
    state: "FRESH", ageMs: 2, observations: [{ value: null, other: 0 }],
    provenance: { provider: "TEST", sourceUrl: "https://test", observedAt: "2026-10-02T00:00:00Z" },
  };
  const first = createEvidenceSnapshot({ capturedAt: "2026-10-02T00:00:01Z", providers: { b: provider, a: provider } });
  const second = createEvidenceSnapshot({ capturedAt: "2026-10-02T00:00:01Z", providers: { a: provider, b: provider } });
  assert.equal(first.hash, second.hash);
  assert.equal(first.providers.a.observations[0].value, null);
  assert.ok(Object.isFrozen(first.providers.a.observations[0]));
  assert.equal(verifyEvidenceSnapshot(first), true);
  assert.equal(verifyEvidenceSnapshot({ ...first, instrument: "tampered" }), false);
});

test("journal atomically appends immutable versioned events with bounded indexes", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "forex-journal-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  let id = 0;
  const store = createJournalStore({
    filePath: path.join(directory, "journal.json"),
    maxIndexEntries: 2,
    idFactory: () => `event-${++id}`,
    now: () => "2026-10-02T00:00:00Z",
  });
  const first = await store.recordProviderObservation({ source: "fred", value: null });
  await Promise.all([
    store.recordSnapshot({ hash: "abc" }),
    store.recordDecision({ action: "WAIT" }),
    store.recordIntent({ side: "buy" }),
  ]);
  const loaded = await store.load();
  assert.equal(loaded.events.length, 4);
  assert.deepEqual(loaded.events.map((event) => event.sequence), [1, 2, 3, 4]);
  assert.equal(loaded.events[0].payload.value, null);
  assert.equal(loaded.indexes.recent.length, 2);
  assert.ok(Object.isFrozen(first));
  await assert.rejects(store.append("UNKNOWN", {}), /TYPE_INVALID/);
  await assert.rejects(store.recordFill({}, { eventId: first.eventId }), /DUPLICATE/);
  assert.equal((await createJournalStore({ filePath: store.path }).get(first.eventId)).eventId, first.eventId);
});

test("OANDA stream supervisor reconnects pricing while transaction protection remains independent", async () => {
  let pricingAttempts = 0;
  let received;
  const priceReceived = new Promise(resolve => { received = resolve; });
  const waitForAbort = signal => new Promise(resolve => {
    const timer = setTimeout(resolve, 500);
    timer.unref?.();
    signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
  });
  const client = {
    token: "practice",
    liveHost: false,
    async *streamPrices(_instruments, { signal }) {
      pricingAttempts += 1;
      if (pricingAttempts === 1) throw new Error("TRANSIENT_STREAM_FAILURE");
      yield { type: "PRICE", instrument: "EUR_USD", time: "2026-10-02T00:00:00Z" };
      await waitForAbort(signal);
    },
    async *streamTransactions({ signal }) {
      yield { type: "HEARTBEAT", time: "2026-10-02T00:00:00Z" };
      await waitForAbort(signal);
    },
  };
  const supervisor = createOandaStreamSupervisor({
    instruments: ["EUR_USD"],
    onPrice: event => { if (event.type === "PRICE") received(event); },
  });
  supervisor.start(client);
  let timeout;
  const event = await Promise.race([
    priceReceived,
    new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error("STREAM_RECONNECT_TIMEOUT")), 2000);
    }),
  ]).finally(() => clearTimeout(timeout));
  assert.equal(event.instrument, "EUR_USD");
  assert.ok(pricingAttempts >= 2);
  assert.ok(supervisor.snapshot().pricing.reconnects >= 1);
  assert.equal(supervisor.getPrice("EUR_USD").type, "PRICE");
  supervisor.stop();
});
