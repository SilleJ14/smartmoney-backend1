import test from "node:test";
import assert from "node:assert/strict";
import { registerLiveMoversRoutes } from "../routes/liveMoversRoutes.js";

const normalizeSymbol = (symbol) => String(symbol || "").toUpperCase();
const isCrypto = (symbol) => String(symbol || "").includes("/");

test("live movers can actively refresh a bounded visible candidate before responding", async () => {
  const routes = new Map();
  const app = {
    get: (path, ...handlers) => routes.set(path, handlers.at(-1)),
  };
  const state = {
    marketOpen: true,
    topCryptoSignals: [{
      symbol: "BTC/USD",
      price: 100,
      previousClose: 95,
      masterFinalScore: 72,
      score: 72,
      qualifiedToBuy: true,
    }],
    liveQuoteCache: {},
  };
  let refreshedSymbols = [];
  registerLiveMoversRoutes(app, {
    requireAdmin: () => {},
    getState: () => state,
    normalizeSymbol,
    isCrypto,
    mergeLiveQuote: (signal) => ({
      ...signal,
      ...(state.liveQuoteCache[normalizeSymbol(signal.symbol)] || {}),
    }),
    refreshQuotes: async (symbols) => {
      refreshedSymbols = symbols;
      state.liveQuoteCache["BTC/USD"] = {
        price: 101,
        bid: 100.9,
        ask: 101.1,
        spreadAvailable: true,
        spreadPercent: 0.2,
        liveQuoteUpdatedAt: "2026-08-30T12:00:00.000Z",
        liveQuoteSource: "alpaca_crypto_latest",
        priceIsLive: true,
      };
      return { ok: true, freshCount: 1 };
    },
    getRuntimeStatus: () => ({}),
  });
  const req = { query: { refresh: "true", limit: "20" } };
  const res = { json(body) { this.body = body; } };
  await routes.get("/live-movers")(req, res);

  assert.deepEqual(refreshedSymbols, ["BTC/USD"]);
  assert.equal(res.body.activeQuoteRefresh.freshCount, 1);
  assert.equal(res.body.movers[0].livePrice, 101);
  assert.equal(res.body.movers[0].liveQuoteUpdatedAt, "2026-08-30T12:00:00.000Z");
});

test("live movers exposes canonical items and reuses a versioned short cache", async () => {
  const routes = new Map();
  const app = { get: (path, ...handlers) => routes.set(path, handlers.at(-1)) };
  const state = {
    marketOpen: true,
    liveQuoteCacheVersion: 7,
    lastScanAt: "2026-09-01T14:30:00.000Z",
    lastStockSignals: [{
      symbol: "AAPL",
      price: 105,
      previousClose: 100,
      stockDecisionScore: 82,
      stockDecisionScoreAvailable: true,
      stockDecisionEvidence: { coreEvidencePass: true },
    }],
    liveQuoteCache: {},
  };
  let mergeCalls = 0;
  registerLiveMoversRoutes(app, {
    requireAdmin: () => {},
    getState: () => state,
    normalizeSymbol,
    isCrypto,
    mergeLiveQuote: (signal) => { mergeCalls += 1; return signal; },
    getRuntimeStatus: () => ({}),
  });
  const invoke = async () => {
    const req = { query: { limit: "20" } };
    const res = { json(body) { this.body = body; } };
    await routes.get("/live-movers")(req, res);
    return res.body;
  };

  const first = await invoke();
  const callsAfterFirst = mergeCalls;
  const second = await invoke();
  assert.equal(first.cache.hit, false);
  assert.equal(second.cache.hit, true);
  assert.equal(mergeCalls, callsAfterFirst);
  assert.equal(second.items, second.movers);
  assert.equal(second.signals, undefined);
  assert.equal(second.stockSignals, undefined);
  assert.equal(second.cryptoSignals, undefined);

  state.liveQuoteCacheVersion = 8;
  const third = await invoke();
  assert.equal(third.cache.hit, false);
  assert.ok(mergeCalls > callsAfterFirst);
});
