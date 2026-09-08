import test from "node:test";
import assert from "node:assert/strict";
import {
  getStockExecutionEvidenceFreshness,
  mergeLiveStockQuoteWithReference,
} from "../market-data/stockQuoteEvidence.js";

test("selected newer bid-ask replaces stale spread numbers and source as one unit", () => {
  const result = mergeLiveStockQuoteWithReference({ price: 100, bid: 98, ask: 102,
    spread: 4, spreadPercent: 4, spreadUpdatedAt: "2026-09-01T14:00:00Z", spreadSource: "old" },
  { bid: 99.9, ask: 100.1, spread: 99, spreadPercent: 99,
    spreadUpdatedAt: "2026-09-01T14:01:00Z", spreadSource: "new" });
  assert.equal(result.bid, 99.9);
  assert.equal(result.ask, 100.1);
  assert.ok(Math.abs(result.spreadPercent - 0.2) < 1e-8);
  assert.ok(Math.abs(result.spread - 0.2) < 1e-8);
  assert.equal(result.spreadSource, "new");
  assert.equal(result.spreadUpdatedAt, "2026-09-01T14:01:00Z");
  const unavailable = mergeLiveStockQuoteWithReference({ price: 100, bid: 99, spreadPercent: 0 }, { ask: 101 });
  assert.equal(unavailable.spreadAvailable, false);
  assert.equal(unavailable.spreadPercent, null);
});

test("live stock price merges with authoritative daily reference evidence", () => {
  const merged = mergeLiveStockQuoteWithReference(
    {
      symbol: "TEST",
      price: 105,
      current: 105,
      previousClose: 103,
      open: 104,
      high: 106,
      low: 103.5,
      volume: 250,
      bid: 104.98,
      ask: 105.02,
      spreadUpdatedAt: "2026-09-01T14:30:04.000Z",
      liveQuoteUpdatedAt: "2026-09-01T14:30:04.000Z",
      liveQuoteSource: "polygon_websocket_trade",
      priceIsLive: true,
      percentChange: 1.94,
      percentChangeAvailable: true,
    },
    {
      symbol: "TEST",
      price: 104,
      previousClose: 100,
      open: 101,
      high: 107,
      low: 99,
      volume: 1_250_000,
      bid: 103.9,
      ask: 104.1,
      spreadUpdatedAt: "2026-09-01T14:29:59.000Z",
      source: "polygon_rest_quote",
    }
  );

  assert.equal(merged.price, 105);
  assert.equal(merged.current, 105);
  assert.equal(merged.previousClose, 100);
  assert.equal(merged.open, 101);
  assert.equal(merged.high, 107);
  assert.equal(merged.low, 99);
  assert.equal(merged.volume, 1_250_000);
  assert.equal(merged.bid, 104.98);
  assert.equal(merged.ask, 105.02);
  assert.equal(merged.liveQuoteUpdatedAt, "2026-09-01T14:30:04.000Z");
  assert.equal(merged.percentChange, 5);
  assert.equal(merged.percentChangeAvailable, true);
  assert.equal(merged.percentChangeReferencePrice, 100);
  assert.equal(merged.percentChangeReferenceType, "previous_close");
});

test("stock execution freshness treats trade and spread timestamps independently", () => {
  const now = Date.parse("2026-09-01T14:30:05.000Z");
  const staleSpread = getStockExecutionEvidenceFreshness({
    price: 100,
    bid: 99.99,
    ask: 100.01,
    spreadAvailable: true,
    liveQuoteUpdatedAt: "2026-09-01T14:30:04.000Z",
    spreadUpdatedAt: "2026-09-01T14:29:50.000Z",
    liveQuoteSource: "finnhub_ws_trade",
    spreadSource: "alpaca_latest_stock_quote",
    priceIsLive: true,
  }, { now, maxAgeSeconds: 15 });
  assert.equal(staleSpread.quoteFresh, true);
  assert.equal(staleSpread.spreadFresh, false);
  assert.equal(staleSpread.maximumAgeSeconds, 5);

  const fresh = getStockExecutionEvidenceFreshness({
    price: 100,
    bid: 99.99,
    ask: 100.01,
    spreadAvailable: true,
    liveQuoteUpdatedAt: "2026-09-01T14:30:04.000Z",
    spreadUpdatedAt: "2026-09-01T14:30:04.000Z",
    liveQuoteSource: "alpaca_latest_stock_quote",
    spreadSource: "alpaca_latest_stock_quote",
    priceIsLive: true,
  }, { now });
  assert.equal(fresh.quoteFresh, true);
  assert.equal(fresh.spreadFresh, true);
});

test("reference bid and ask fill a trade-only live tick without taking price authority", () => {
  const merged = mergeLiveStockQuoteWithReference(
    {
      price: 50,
      liveQuoteUpdatedAt: "2026-09-01T14:30:04.000Z",
      source: "polygon_websocket_trade",
    },
    {
      price: 49,
      previousClose: 50,
      bid: 49.95,
      ask: 50.05,
      spreadUpdatedAt: "2026-09-01T14:30:03.000Z",
      source: "polygon_rest_quote",
    }
  );

  assert.equal(merged.price, 50);
  assert.equal(merged.bid, 49.95);
  assert.equal(merged.ask, 50.05);
  assert.equal(merged.spreadSource, "polygon_rest_quote");
  assert.equal(merged.percentChange, 0);
  assert.equal(merged.percentChangeAvailable, true);
});

test("stock reference merge leaves change unavailable without a real previous close", () => {
  const merged = mergeLiveStockQuoteWithReference(
    { price: 25, percentChange: 0, percentChangeAvailable: true },
    { volume: 500_000 }
  );

  assert.equal(merged.percentChange, null);
  assert.equal(merged.changePercent, null);
  assert.equal(merged.percentChangeAvailable, false);
});
