import test from "node:test";
import assert from "node:assert/strict";
import { clearClosedPositionState, registerManualExecutionRoutes } from "../routes/manualExecutionRoutes.js";

test("manual close clears learned position state and starts cooldown", () => {
  const state = { symbolCooldowns: {}, highWaterMarks: { AAPL: 10 }, aiEntryScores: { AAPL: 90 }, runnerPositions: { AAPL: {} } };
  clearClosedPositionState(state, "AAPL", "now");
  assert.equal(state.symbolCooldowns.AAPL, "now");
  assert.equal(state.highWaterMarks.AAPL, undefined);
  assert.equal(state.aiEntryScores.AAPL, undefined);
  assert.equal(state.runnerPositions.AAPL, undefined);
});

test("dedicated crypto route requires an approved sized candidate before broker submission", async () => {
  const routes = new Map(), calls = [];
  const app = { post: (route, ...handlers) => routes.set(route, handlers.at(-1)) };
  const state = { lastCryptoSignals: [{ symbol: "BTCUSD", qualifiedToBuy: true, priceIsLive: true,
    spreadAvailable: true, recommendedTradeAmount: 25 }], aiManagedSymbols: [] };
  registerManualExecutionRoutes(app, {
    requireAdmin: () => {}, normalizeSymbol: (value) => String(value || "").replace("/", "").toUpperCase(),
    getAsset: async () => ({}), getStockQuote: async () => ({}), manualStockBuy: async () => ({}),
    manualCryptoBuy: async (input) => { calls.push(input); return { id: "order-1" }; },
    markManagedSymbol: () => {}, getState: () => state, closePosition: async () => ({}),
    recordOrder: () => {}, recordFailedOrder: () => {}, logger: { log() {} },
  });
  const res = { status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await routes.get("/manual-buy-crypto")({ body: { symbol: "BTC/USD", dollars: 25 } }, res);
  assert.equal(res.body.ok, true);
  assert.deepEqual(calls, [{ symbol: "BTCUSD", dollars: 25 }]);
  const oversized = { status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await routes.get("/manual-buy-crypto")({ body: { symbol: "BTCUSD", dollars: 26 } }, oversized);
  assert.equal(oversized.statusCode, 409);
});
