import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateLiveQuoteProviderReadiness,
  getLiveQuoteProvider,
  getSpreadAgeSeconds,
  isFreshMeasuredSpread,
  isFreshLiveQuote,
  isLiveQuoteSource,
  mergeLiveQuoteEvidence,
} from "../live/liveQuoteCache.js";

test("recognizes Polygon, Finnhub, and fresh Alpaca quote sources", () => {
  assert.equal(getLiveQuoteProvider("polygon_ws_quote"), "polygon");
  assert.equal(getLiveQuoteProvider("finnhub_ws_trade"), "finnhub");
  assert.equal(getLiveQuoteProvider("alpaca_latest_stock_quote"), "alpaca");
  assert.equal(getLiveQuoteProvider("alpaca_crypto_latest"), "alpaca");
  assert.equal(isLiveQuoteSource("alpaca_latest_stock_quote"), true);
  assert.equal(isLiveQuoteSource("polygon_snapshot_mover_fallback"), false);
});

test("accepts Finnhub when Polygon is disconnected", () => {
  const evidence = evaluateLiveQuoteProviderReadiness("finnhub_ws_trade", {
    polygonConnected: false,
    finnhubConnected: true,
  });
  assert.equal(evidence.provider, "finnhub");
  assert.equal(evidence.connected, true);
});

test("requires the provider that produced the quote to be connected", () => {
  const polygon = evaluateLiveQuoteProviderReadiness("polygon_ws_quote", {
    polygonConnected: false,
    finnhubConnected: true,
  });
  assert.equal(polygon.connected, false);
  assert.equal(polygon.reason, "POLYGON_LIVE_QUOTE_PROVIDER_DISCONNECTED");

  const finnhub = evaluateLiveQuoteProviderReadiness("finnhub_ws_trade", {
    polygonConnected: true,
    finnhubConnected: false,
  });
  assert.equal(finnhub.connected, false);
  assert.equal(finnhub.reason, "FINNHUB_LIVE_QUOTE_PROVIDER_DISCONNECTED");
});

test("accepts Alpaca latest quotes while rejecting unknown or unsupported crypto sources", () => {
  const alpaca = evaluateLiveQuoteProviderReadiness("alpaca_latest_stock_quote");
  assert.equal(alpaca.provider, "alpaca");
  assert.equal(alpaca.connected, true);

  const cryptoFinnhub = evaluateLiveQuoteProviderReadiness("finnhub_ws_trade", {
    isCrypto: true,
    finnhubConnected: true,
  });
  assert.equal(cryptoFinnhub.connected, false);

  const unknown = evaluateLiveQuoteProviderReadiness("scan_snapshot", {
    polygonConnected: true,
    finnhubConnected: true,
  });
  assert.equal(unknown.provider, null);
  assert.equal(unknown.connected, false);
});

test("future provider timestamps cannot be treated as fresh live quotes", () => {
  const futureQuote = {
    liveQuoteUpdatedAt: new Date(Date.now() + 60_000).toISOString(),
    liveQuoteSource: "alpaca_latest_stock_quote",
  };

  assert.equal(isFreshLiveQuote(futureQuote, {
    maxAgeSeconds: 5,
    isLiveQuoteSource,
  }), false);
});

test("trade-only ticks preserve measured bid/ask without refreshing spread age", () => {
  const spreadTime = "2026-08-31T14:00:00.000Z";
  const tradeTime = "2026-08-31T14:00:04.000Z";
  const merged = mergeLiveQuoteEvidence(
    {
      bid: 99.9,
      ask: 100.1,
      spreadAvailable: true,
      spreadUpdatedAt: spreadTime,
      spreadSource: "alpaca_latest_stock_quote",
    },
    {
      price: 100.05,
      liveQuoteSource: "finnhub_ws_trade",
      liveQuoteUpdatedAt: tradeTime,
    },
    {
      price: 100.05,
      quoteUpdatedAt: tradeTime,
      quoteSource: "finnhub_ws_trade",
    }
  );

  assert.equal(merged.bid, 99.9);
  assert.equal(merged.ask, 100.1);
  assert.equal(merged.spreadAvailable, true);
  assert.equal(merged.spreadUpdatedAt, spreadTime);
  assert.equal(merged.spreadSource, "alpaca_latest_stock_quote");
  assert.equal(merged.spreadPreservedFromPrevious, true);
});

test("a fresh trade cannot make an old spread execution-ready", () => {
  const quote = {
    bid: 99.9,
    ask: 100.1,
    spreadAvailable: true,
    spreadUpdatedAt: "2026-08-31T14:00:00.000Z",
    liveQuoteUpdatedAt: "2026-08-31T14:00:20.000Z",
  };
  const now = Date.parse("2026-08-31T14:00:20.000Z");

  assert.equal(getSpreadAgeSeconds(quote, now), 20);
  assert.equal(isFreshMeasuredSpread(quote, { maxAgeSeconds: 5, now }), false);
});

test("a newer two-sided quote replaces and refreshes spread evidence", () => {
  const quoteTime = "2026-08-31T14:00:04.000Z";
  const merged = mergeLiveQuoteEvidence(
    {
      bid: 99.9,
      ask: 100.1,
      spreadAvailable: true,
      spreadUpdatedAt: "2026-08-31T14:00:00.000Z",
    },
    { bid: 100, ask: 100.04 },
    {
      price: 100.02,
      quoteUpdatedAt: quoteTime,
      quoteSource: "alpaca_latest_stock_quote",
    }
  );

  assert.equal(merged.bid, 100);
  assert.equal(merged.ask, 100.04);
  assert.equal(merged.spreadUpdatedAt, quoteTime);
  assert.equal(merged.spreadPreservedFromPrevious, false);
});
