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
    getAsset: async () => ({ fractionable: true }), polygonQuote: async () => null,
    getPolygonContext: () => ({}) });
  const res = { status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; } };
  await routes.get("/stock-quote/:symbol")({ params: { symbol: "aapl" } }, res);
  assert.equal(res.body.stock.symbol, "AAPL");
  assert.equal(res.body.stock.changePercent, 10);
  assert.equal(res.body.stock.fractionable, true);
  assert.deepEqual(res.body.stock.historicalBars, res.body.stock.chartBars);
});
