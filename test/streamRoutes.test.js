import test from "node:test";
import assert from "node:assert/strict";
import { registerStreamRoutes } from "../routes/streamRoutes.js";

test("enhanced stream registers, replays, and removes clients", () => {
  const routes = new Map(), clients = new Set(), events = {};
  const app = { get: (path, ...handlers) => routes.set(path, handlers.at(-1)) };
  registerStreamRoutes(app, { requireAdmin: () => {}, normalizeSymbol: (s) => s.trim().toUpperCase(),
    getCorsOrigin: () => "https://app", backendClients: clients, liveSignalClients: new Set(),
    replayEvents: (_res, since) => { events.since = since; }, pushEvent: () => {}, getState: () => ({}),
    getMode: () => "smart", buildLiveSignalPayload: () => ({}), setIntervalFn: () => 1, clearIntervalFn: () => {} });
  const req = { query: { symbols: "aapl, msft", since: "42" }, on: (name, fn) => { events[name] = fn; } };
  const res = { writeHead() {}, write(value) { this.output = value; } };
  routes.get("/stream")(req, res);
  assert.deepEqual(res.allowedSymbols, ["AAPL", "MSFT"]);
  assert.equal(clients.has(res), true); assert.equal(events.since, "42");
  events.close(); assert.equal(clients.has(res), false);
});
