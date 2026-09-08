import test from "node:test";
import assert from "node:assert/strict";
import { registerSignalObservabilityRoutes } from "../routes/signalObservabilityRoutes.js";

test("signal observability registers bounded read and decision-audit endpoints", () => {
  const routes = new Map(), app = { get: (path, ...handlers) => routes.set(path, handlers.at(-1)) };
  registerSignalObservabilityRoutes(app, {
    requireAdmin: () => {}, getState: () => ({}), buildHighConvictionSummary: () => ({}),
    buildLiveQuotesPayload: () => ({}), getProductionContext: () => ({ activeBuyLocks: [], liveSignalClientCount: 0 }),
    normalizeSymbol: String, savePendingExits: () => [], getOpenOrders: async () => [],
  });
  assert.deepEqual([...routes.keys()], ["/high-conviction", "/production-health", "/live-quotes", "/live-market-memory", "/pending-exits", "/decision-audit"]);
});

test("compact live quote polling forwards version and timestamp cursors", () => {
  const routes = new Map();
  const app = { get: (path, ...handlers) => routes.set(path, handlers.at(-1)) };
  let received = null;
  registerSignalObservabilityRoutes(app, {
    requireAdmin: () => {}, getState: () => ({}), buildHighConvictionSummary: () => ({}),
    buildLiveQuotesPayload: (symbols, options) => {
      received = { symbols, options };
      return { ok: true, stateVersion: 9, count: 0, items: [], quotes: [] };
    },
    getProductionContext: () => ({ activeBuyLocks: [], liveSignalClientCount: 0 }),
    normalizeSymbol: String, savePendingExits: () => [], getOpenOrders: async () => [],
  });
  const req = { query: {
    symbols: "AAPL,BTC/USD",
    compact: "1",
    sinceVersion: "9",
    since: "2026-09-01T14:30:00.000Z",
  } };
  const res = { json(body) { this.body = body; } };

  routes.get("/live-quotes")(req, res);

  assert.deepEqual(received, {
    symbols: ["AAPL", "BTC/USD"],
    options: {
      compact: true,
      sinceVersion: 9,
      since: "2026-09-01T14:30:00.000Z",
    },
  });
  assert.equal(res.body.count, 0);
});
