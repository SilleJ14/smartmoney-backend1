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
    getVerifiedCryptoQuote: async () => ({ quoteReady: true, quote: {
      current: 100, price: 100, bid: 99.9, ask: 100.1, spreadPercent: 0.2,
      spreadAvailable: true, priceIsLive: true, updatedAt: new Date().toISOString(),
    } }),
    evaluateCryptoCandidate: () => ({ approved: true, reasons: [] }),
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

test("manual stock route is enabled but still requires a tradable asset", async () => {
  const routes = new Map();
  const calls = [];
  const records = [];
  const app = { post: (route, ...handlers) => routes.set(route, handlers.at(-1)) };
  const state = { aiManagedSymbols: [] };
  let marketOpen = true;
  const dependencies = {
    requireAdmin: () => {},
    normalizeSymbol: (value) => String(value || "").toUpperCase(),
    getAsset: async () => ({ status: "active", tradable: true, fractionable: true }),
    getStockQuote: async () => ({ current: 100 }),
    getMarketOpen: async () => marketOpen,
    getVerifiedStockQuote: async () => ({ quoteReady: true, quote: {
      current: 100, price: 100, bid: 99.9, ask: 100.1, spreadPercent: 0.2,
      spreadAvailable: true, priceIsLive: true, updatedAt: new Date().toISOString(),
    } }),
    manualStockBuy: async (input) => {
      calls.push(input);
      return { id: "stock-order-1" };
    },
    manualCryptoBuy: async () => ({}),
    markManagedSymbol: () => {},
    getState: () => state,
    closePosition: async () => ({}),
    recordOrder: (...args) => records.push(args),
    recordFailedOrder: () => {},
    logger: { log() {} },
  };
  registerManualExecutionRoutes(app, dependencies);
  const res = { status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await routes.get("/manual-buy-stock")({ body: { symbol: "AAPL", dollars: 25, buyMode: "dollars" } }, res);
  assert.equal(res.body.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(records[0][0], "MANUAL_STOCK_BUY");
  assert.equal(calls[0].marketOpen, true);

  marketOpen = false;
  const closed = { status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await routes.get("/manual-buy-stock")({ body: { symbol: "AAPL", dollars: 25, buyMode: "dollars" } }, closed);
  assert.equal(closed.statusCode, 409);
  assert.match(closed.body.error, /regular market is closed/i);
  assert.equal(calls.length, 1);

  marketOpen = true;
  dependencies.getAsset = async () => ({ status: "inactive", tradable: false, fractionable: false });
  const blockedRoutes = new Map();
  registerManualExecutionRoutes({ post: (route, ...handlers) => blockedRoutes.set(route, handlers.at(-1)) }, dependencies);
  const blocked = { status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await blockedRoutes.get("/manual-buy-stock")({ body: { symbol: "NOPE", dollars: 25, buyMode: "dollars" } }, blocked);
  assert.equal(blocked.statusCode, 409);
  assert.match(blocked.body.error, /not an active tradable asset/i);
});

test("AI-sized stock route re-verifies quote, decision, sizing, and hold category", async () => {
  const routes = new Map();
  const submitted = [];
  const now = new Date().toISOString();
  const candidate = {
    symbol: "AAPL",
    assetClass: "stock",
    recommendedTradeAmount: 25,
    decisionUpdatedAt: now,
  };
  registerManualExecutionRoutes({ post: (route, ...handlers) => routes.set(route, handlers.at(-1)) }, {
    requireAdmin: () => {},
    normalizeSymbol: (value) => String(value || "").toUpperCase(),
    getAsset: async () => ({ status: "active", tradable: true, fractionable: true }),
    getStockQuote: async () => ({ current: 100 }),
    getMarketOpen: async () => true,
    getVerifiedStockQuote: async () => ({ quoteReady: true, quote: {
      current: 100, price: 100, bid: 99.9, ask: 100.1, spreadPercent: 0.2,
      spreadAvailable: true, priceIsLive: true, updatedAt: now,
    } }),
    manualStockBuy: async (input) => { submitted.push(input); return { id: "verified-order" }; },
    manualCryptoBuy: async () => ({}),
    evaluateStockCandidate: (input) => ({
      approved: input.liveQuote?.updatedAt === now,
      reasons: [],
      finalScore: 82,
      quoteAgeSeconds: 0,
    }),
    markManagedSymbol: () => {},
    getState: () => ({ lastStockSignals: [candidate] }),
    closePosition: async () => ({}),
    recordOrder: () => {},
    recordFailedOrder: () => {},
    logger: { log() {} },
  });
  const res = { status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await routes.get("/buy-stock-signal")({ body: {
    symbol: "AAPL", dollars: 25, holdCategory: "multi_day",
  } }, res);
  assert.equal(res.body.ok, true);
  assert.equal(submitted[0].holdCategory, "multi_day");
  assert.equal(submitted[0].referencePrice, 100);
  assert.equal(submitted[0].marketOpen, true);

  const oversized = { status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await routes.get("/buy-stock-signal")({ body: { symbol: "AAPL", dollars: 26 } }, oversized);
  assert.equal(oversized.statusCode, 409);
  assert.match(oversized.body.error, /sizing limit/i);
});

test("manual closes block stocks after hours while allowing crypto 24/7", async () => {
  const routes = new Map();
  const closedSymbols = [];
  registerManualExecutionRoutes({ post: (route, ...handlers) => routes.set(route, handlers.at(-1)) }, {
    requireAdmin: () => {},
    normalizeSymbol: (value) => String(value || "").replace("/", "").toUpperCase(),
    getMarketOpen: async () => false,
    isCryptoSymbol: (symbol) => String(symbol || "").endsWith("USD"),
    getState: () => ({ symbolCooldowns: {}, highWaterMarks: {}, aiEntryScores: {}, runnerPositions: {} }),
    closePosition: async (symbol) => { closedSymbols.push(symbol); return { id: "close-1" }; },
    recordOrder: () => {},
    recordFailedOrder: () => {},
  });

  const stockResponse = { status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await routes.get("/close-position")({ body: { symbol: "AAPL" } }, stockResponse);
  assert.equal(stockResponse.statusCode, 409);
  assert.deepEqual(closedSymbols, []);

  const cryptoResponse = { status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await routes.get("/close-position")({ body: { symbol: "BTC/USD" } }, cryptoResponse);
  assert.deepEqual(closedSymbols, ["BTCUSD"]);
  assert.match(cryptoResponse.body.message, /BTCUSD/);
});
