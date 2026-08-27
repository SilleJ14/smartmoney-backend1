import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateLiveQuoteProviderReadiness,
  getLiveQuoteProvider,
  isFreshLiveQuote,
  isLiveQuoteSource,
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
