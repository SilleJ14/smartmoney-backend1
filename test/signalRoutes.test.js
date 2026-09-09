import test from "node:test";
import assert from "node:assert/strict";
import { registerSignalRoutes } from "../routes/signalRoutes.js";

test("signals endpoint reads state and merges live prices", () => {
  const routes = new Map(), app = { get: (path, ...handlers) => routes.set(path, handlers.at(-1)) };
  registerSignalRoutes(app, { requireAdmin: () => {}, getState: () => ({ lastScanAt: "now", lastSignals: [{ price: 1 }], skippedSymbols: [] }),
    getMode: () => "smart", mergeLiveQuote: (signal) => ({ ...signal, price: 2 }), scanCrypto: async () => [],
    buildDashboard: () => ({}), initializeJournal: () => {} });
  const res = { json(body) { this.body = body; } }; routes.get("/signals")({}, res);
  assert.equal(res.body.signals[0].price, 2);
  assert.equal(routes.size, 4);
});
