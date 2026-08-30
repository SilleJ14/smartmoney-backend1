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
