import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { attachBoundedStream, closeBoundedStream, writeBoundedStream } from "../live/boundedStream.js";
import { registerStreamRoutes } from "../routes/streamRoutes.js";

class Client extends EventEmitter {
  output = [];
  destroyed = false;
  statusCode = 200;
  backpressure = false;
  write(message) { this.output.push(message); return !this.backpressure; }
  writeHead(status) { this.statusCode = status; }
  setHeader() {}
  status(status) { this.statusCode = status; return this; }
  json(payload) { this.payload = payload; return this; }
  destroy() { this.destroyed = true; this.emit("close"); }
}
const request = () => Object.assign(new EventEmitter(), { query: {} });

test("healthy SSE events remain intact and in order", () => {
  const client = new Client();
  attachBoundedStream(client, { maxBufferedBytes: 100 });
  const events = ["data: {\"symbol\":\"AAPL\"}\n\n", "event: HEALTH_EVENT\ndata: {}\n\n"];
  for (const event of events) assert.equal(writeBoundedStream(client, event), true);
  assert.deepEqual(client.output, events);
  assert.equal(client.destroyed, false);
  closeBoundedStream(client);
});

test("backpressure queues only a bounded number of bytes then closes and cleans up", () => {
  const client = new Client();
  client.backpressure = true;
  let cleaned = 0;
  attachBoundedStream(client, { maxBufferedBytes: 100, onClose: () => cleaned++ });
  assert.equal(writeBoundedStream(client, "a".repeat(60)), true);
  assert.equal(writeBoundedStream(client, "b".repeat(40)), true);
  assert.equal(writeBoundedStream(client, "c"), false);
  assert.equal(client.output.join("").length, 100);
  assert.equal(client.destroyed, true);
  assert.equal(cleaned, 1);
  assert.equal(client.listenerCount("drain"), 0);
  assert.equal(writeBoundedStream(client, "retry"), false);
  assert.equal(cleaned, 1);
});

test("drain releases the byte budget without dropping an accepted event", () => {
  const client = new Client();
  client.backpressure = true;
  attachBoundedStream(client, { maxBufferedBytes: 80 });
  assert.equal(writeBoundedStream(client, "a".repeat(60)), true);
  client.emit("drain");
  assert.equal(writeBoundedStream(client, "b".repeat(60)), true);
  assert.equal(client.destroyed, false);
  assert.equal(client.output.length, 2);
  closeBoundedStream(client);
});

test("an idle stalled client is destroyed at the backpressure deadline", () => {
  const client = new Client();
  client.backpressure = true;
  let expire, cleared = 0;
  attachBoundedStream(client, {
    setTimeoutFn: fn => { expire = fn; return 1; }, clearTimeoutFn: () => cleared++,
  });
  assert.equal(writeBoundedStream(client, "data: {}\n\n"), true);
  expire();
  assert.equal(client.destroyed, true);
  assert.equal(cleared, 1);
});

test("wire-byte budget handles multibyte strings and existing socket buffers", () => {
  const unicode = new Client();
  attachBoundedStream(unicode, { maxBufferedBytes: 8 });
  assert.equal(writeBoundedStream(unicode, "€€€"), false);
  assert.equal(unicode.output.length, 0);
  const buffered = new Client();
  buffered.socket = { writableLength: 75 };
  attachBoundedStream(buffered, { maxBufferedBytes: 100 });
  assert.equal(writeBoundedStream(buffered, "x".repeat(26)), false);
  assert.equal(buffered.destroyed, true);
});

test("write exceptions and peer close release the client exactly once", () => {
  let cleaned = 0;
  const client = new Client();
  client.write = () => { throw new Error("socket closed"); };
  attachBoundedStream(client, { onClose: () => cleaned++ });
  assert.equal(writeBoundedStream(client, "data: {}\n\n"), false);
  client.emit("close");
  closeBoundedStream(client);
  assert.equal(cleaned, 1);
});

function routesFixture(options = {}) {
  const routes = new Map(), backendClients = new Set(), liveSignalClients = new Set();
  const heartbeats = new Map();
  let nextId = 0, globalPushes = 0;
  registerStreamRoutes({ get: (path, ...handlers) => routes.set(path, handlers.at(-1)) }, {
    requireAdmin() {}, normalizeSymbol: value => value.trim().toUpperCase(),
    getCorsOrigin: () => "https://offline.invalid", backendClients, liveSignalClients,
    replayEvents() {}, pushEvent: () => globalPushes++, getState: () => ({}),
    getMode: () => "smart", buildLiveSignalPayload: () => ({ type: "LIVE_SIGNAL_UPDATE", items: [] }),
    setIntervalFn: callback => { heartbeats.set(++nextId, callback); return nextId; },
    clearIntervalFn: id => heartbeats.delete(id), ...options,
  });
  return { routes, backendClients, liveSignalClients, heartbeats, globalPushes: () => globalPushes };
}

test("N client heartbeats write N events, never N squared global broadcasts", () => {
  const fixture = routesFixture();
  const clients = Array.from({ length: 4 }, () => new Client());
  clients.forEach(client => fixture.routes.get("/stream")(request(), client));
  for (const heartbeat of fixture.heartbeats.values()) heartbeat();
  assert.equal(fixture.globalPushes(), 0);
  assert.deepEqual(clients.map(client => client.output.filter(value => value.includes("event: HEALTH_EVENT")).length), [1, 1, 1, 1]);
  clients.forEach(closeBoundedStream);
  assert.equal(fixture.heartbeats.size, 0);
  assert.equal(fixture.backendClients.size, 0);
});

test("stream capacity is shared across both endpoints and released on disconnect", () => {
  const fixture = routesFixture({ maxClients: 2 });
  const first = new Client(), second = new Client(), third = new Client();
  fixture.routes.get("/stream")(request(), first);
  fixture.routes.get("/live-signals/stream")(request(), second);
  fixture.routes.get("/live-signals/stream")(request(), third);
  assert.equal(third.statusCode, 503);
  assert.equal(third.payload.ok, false);
  assert.equal(third.output.length, 0);
  closeBoundedStream(first);
  const replacement = new Client();
  fixture.routes.get("/live-signals/stream")(request(), replacement);
  assert.equal(replacement.statusCode, 200);
  assert.equal(fixture.liveSignalClients.size, 2);
  closeBoundedStream(second);
  closeBoundedStream(replacement);
});

test("oversized initial snapshot cleans registration without leaving a zombie stream", () => {
  const fixture = routesFixture({ buildLiveSignalPayload: () => ({ large: "x".repeat(3 * 1024 * 1024) }) });
  const client = new Client();
  fixture.routes.get("/live-signals/stream")(request(), client);
  assert.equal(client.destroyed, true);
  assert.equal(fixture.liveSignalClients.size, 0);
  assert.equal(client.output.length, 0);
});

test("a closed replay client does not receive CONNECTED or start a heartbeat", () => {
  const fixture = routesFixture({ replayEvents: client => closeBoundedStream(client) });
  const client = new Client();
  fixture.routes.get("/stream")(request(), client);
  assert.equal(client.output.length, 0);
  assert.equal(fixture.backendClients.size, 0);
  assert.equal(fixture.heartbeats.size, 0);
});
