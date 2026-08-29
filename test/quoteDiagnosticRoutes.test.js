import test from "node:test";
import assert from "node:assert/strict";
import { registerQuoteDiagnosticRoutes } from "../routes/quoteDiagnosticRoutes.js";

test("stock quote route normalizes a live manual-search payload", async () => {
  const routes = new Map(), app = { get: (path, ...handlers) => routes.set(path, handlers.at(-1)) };
  registerQuoteDiagnosticRoutes(app, { requireAdmin: () => {}, normalizeSymbol: (value) => value.toUpperCase(),
    getStockQuote: async () => ({
      current: 110,
      previousClose: 100,
      open: 105,
      priceIsLive: true,
      chartBars: [{ t: 1, c: 110 }],
    }),
    getVerifiedStockQuote: async () => ({ quote: {
      current: 111, price: 111, bid: 110.9, ask: 111.1,
      spreadPercent: 0.18, spreadAvailable: true, priceIsLive: true,
      liveQuoteSource: "alpaca_latest_stock_quote",
      updatedAt: "2026-08-27T13:00:00.000Z",
    } }),
    validateStockBuyability: () => ({
      approved: true, spreadPercent: 0.18, spreadAvailable: true,
      quoteAgeSeconds: 1, quoteIsLive: true, blockReasons: [],
      checkedAt: "2026-08-27T13:00:01.000Z",
    }),
    getAsset: async () => ({ status: "active", tradable: true, fractionable: true }), polygonQuote: async () => null,
    getPolygonContext: () => ({}) });
  const res = { status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; } };
  await routes.get("/stock-quote/:symbol")({ params: { symbol: "aapl" } }, res);
  assert.equal(res.body.stock.symbol, "AAPL");
  assert.equal(res.body.stock.current, 111);
  assert.equal(res.body.stock.changePercent, 11);
  assert.equal(res.body.stock.fractionable, true);
  assert.equal(res.body.stock.manuallyBuyable, true);
  assert.equal(res.body.stock.priceIsLive, true);
  assert.deepEqual(res.body.stock.historicalBars, res.body.stock.chartBars);
});

test("stock quote route marks stale or wide-spread quotes as not manually buyable", async () => {
  const routes = new Map(), app = { get: (path, ...handlers) => routes.set(path, handlers.at(-1)) };
  registerQuoteDiagnosticRoutes(app, {
    requireAdmin: () => {}, normalizeSymbol: (value) => value.toUpperCase(),
    getStockQuote: async () => ({ current: 20, previousClose: 19, chartBars: [] }),
    getVerifiedStockQuote: async () => ({ quote: {
      current: 20, price: 20, bid: 17, ask: 23, spreadPercent: 30,
      spreadAvailable: true, priceIsLive: true,
      liveQuoteSource: "alpaca_latest_stock_quote",
      updatedAt: "2026-08-27T12:58:30.000Z",
    } }),
    validateStockBuyability: () => ({
      approved: false, spreadPercent: 30, spreadAvailable: true,
      quoteAgeSeconds: 90, quoteIsLive: true,
      blockReasons: ["Live quote stale: 90s old", "Spread too wide: 30%"],
      checkedAt: "2026-08-27T13:00:00.000Z",
    }),
    getAsset: async () => ({ status: "active", tradable: true, fractionable: true }), polygonQuote: async () => null,
    getPolygonContext: () => ({}),
  });
  const res = { status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; } };
  await routes.get("/stock-quote/:symbol")({ params: { symbol: "dkl" } }, res);
  assert.equal(res.body.stock.symbol, "DKL");
  assert.equal(res.body.stock.manuallyBuyable, false);
  assert.equal(res.body.stock.priceStale, true);
  assert.equal(res.body.stock.quoteAgeSeconds, 90);
  assert.deepEqual(res.body.stock.buyBlockReasons, [
    "Live quote stale: 90s old",
    "Spread too wide: 30%",
  ]);
});
