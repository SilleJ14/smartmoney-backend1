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
