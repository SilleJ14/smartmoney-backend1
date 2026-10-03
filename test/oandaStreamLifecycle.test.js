import test from "node:test";
import assert from "node:assert/strict";
import { createOandaClient } from "../forex/oandaClient.js";
import { createOandaStreamSupervisor } from "../forex/oandaStreamSupervisor.js";

// The stream's own timers are unref'd (the server keeps the loop alive in
// production), so each test holds the event loop open itself.
function keepAlive(t) {
  const handle = setInterval(() => {}, 1000);
  t.after(() => clearInterval(handle));
}

// A response body that delivers one heartbeat, then stalls until aborted.
function stallingFetch(connections) {
  return async (_url, { signal }) => {
    const connection = { signal };
    connections.push(connection);
    let sent = false;
    const body = {
      [Symbol.asyncIterator]() {
        return {
          next() {
            if (!sent) {
              sent = true;
              return Promise.resolve({ done: false, value: Buffer.from('{"type":"HEARTBEAT","time":"t"}\n') });
            }
            return new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
          },
          return() { connection.returned = true; return Promise.resolve({ done: true }); },
        };
      },
    };
    return { ok: true, status: 200, body };
  };
}

test("a stalled price stream closes its own connection on heartbeat timeout", async (t) => {
  keepAlive(t);
  const connections = [];
  const unhandled = [];
  const onUnhandled = (reason) => unhandled.push(reason);
  process.on("unhandledRejection", onUnhandled);
  try {
    const client = createOandaClient({ accountId: "101-001", token: "practice-token", fetchImpl: stallingFetch(connections) });
    const parent = new AbortController();
    const rows = [];
    await assert.rejects((async () => {
      for await (const row of client.streamPrices(["EUR_USD"], { signal: parent.signal, heartbeatTimeoutMs: 30 })) rows.push(row);
    })(), /OANDA_STREAM_HEARTBEAT_TIMEOUT/);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(rows.length, 1);
    assert.equal(connections.length, 1);
    assert.equal(connections[0].signal.aborted, true, "the stalled connection is aborted");
    assert.equal(connections[0].returned, true, "the body iterator is released");
    assert.equal(parent.signal.aborted, false, "the supervisor's controller stays usable");
    assert.deepEqual(unhandled, [], "the abandoned read does not become an unhandled rejection");
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
});

test("a stream that heartbeats once and drops keeps backing off instead of retrying every 250 ms", async (t) => {
  keepAlive(t);
  let clock = 0;
  const attempts = [];
  const sleeps = [];
  const realSetTimeout = globalThis.setTimeout;
  // Record each backoff delay and skip the actual wait.
  globalThis.setTimeout = (fn, ms, ...args) => {
    if (ms >= 100) { sleeps.push(ms); return realSetTimeout(fn, 0, ...args); }
    return realSetTimeout(fn, ms, ...args);
  };
  let supervisor;
  try {
    supervisor = createOandaStreamSupervisor({ now: () => clock, random: () => 1, stableConnectionMs: 60000 });
    const client = {
      token: "practice-token", liveHost: false,
      async *streamPrices() { attempts.push(clock); clock += 1000; yield { type: "HEARTBEAT" }; throw new Error("dropped"); },
      async *streamTransactions() { await new Promise(() => {}); },
    };
    supervisor.start(client);
    while (sleeps.length < 6) await new Promise((resolve) => realSetTimeout(resolve, 1));
  } finally {
    supervisor?.stop();
    globalThis.setTimeout = realSetTimeout;
  }
  assert.deepEqual(sleeps.slice(0, 6), [250, 500, 1000, 2000, 4000, 8000]);
});

test("updating only the stop never sends a null that would cancel the take-profit", async () => {
  const bodies = [];
  const client = createOandaClient({ accountId: "101-001", token: "practice-token",
    fetchImpl: async (_url, options) => { bodies.push(JSON.parse(options.body)); return { ok: true, status: 200, json: async () => ({}), text: async () => "{}" }; } });
  await client.replaceTradeDependentOrders("42", { stopLossPrice: 1.0812 });
  assert.deepEqual(bodies.at(-1), { stopLoss: { price: "1.0812", timeInForce: "GTC" } });
  await assert.rejects(client.replaceTradeDependentOrders("42", {}), /OANDA_DEPENDENT_ORDER_PRICE_REQUIRED/);
});
