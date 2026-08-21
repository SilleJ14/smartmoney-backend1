import test from "node:test";
import assert from "node:assert/strict";
import { registerLiveSignalRoutes } from "../routes/liveSignalRoutes.js";

test("live signals combines stock candidate sources and reports count", async () => {
  const routes = new Map(), app = { get: (path, ...handlers) => routes.set(path, handlers.at(-1)) };
  registerLiveSignalRoutes(app, { requireAdmin: () => {}, getState: () => ({ lastStockSignals: [{ symbol: "A" }],
    fastRunnerCandidates: [{ symbol: "B" }], lastCryptoSignals: [{ symbol: "BTC/USD" }] }), runFastRunnerEngine: async () => {},
    getTopSignals: (items) => items, mergeLiveQuote: (item) => item, getMarketSession: () => "closed",
    getMode: () => "smart", getAutoTradingEnabled: () => false, buildTopBrains: () => [] });
  const res = { json(body) { this.body = body; } }; await routes.get("/live-signals")({}, res);
  assert.equal(res.body.signalCount, 3); assert.equal(routes.size, 3);
});
