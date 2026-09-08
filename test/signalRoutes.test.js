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

test("crypto discovery endpoint remains available when stock execution mode is selected", async () => {
  const routes = new Map();
  const app = { get: (path, ...handlers) => routes.set(path, handlers.at(-1)) };
  let scanCount = 0;
  registerSignalRoutes(app, {
    requireAdmin: () => {},
    getState: () => ({ lastSignals: [], skippedSymbols: [] }),
    getMode: () => "live_stock",
    mergeLiveQuote: (signal) => signal,
    scanCrypto: async () => {
      scanCount += 1;
      return [{ symbol: "BTC/USD", cryptoDiscoveryScore: 71 }];
    },
    buildDashboard: () => ({}),
    initializeJournal: () => {},
  });
  const res = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; },
  };

  await routes.get("/crypto-signals")({}, res);

  assert.equal(res.statusCode, 200);
  assert.equal(scanCount, 1);
  assert.equal(res.body.mode, "live_stock");
  assert.equal(res.body.signals[0].symbol, "BTC/USD");
});
