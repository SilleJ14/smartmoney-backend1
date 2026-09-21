import test from "node:test";
import assert from "node:assert/strict";
import { applyTradeTickWithoutClearingAlpacaBook, resolveCryptoAssetUniverse, FALLBACK_ALPACA_CRYPTO_USD_PAIRS } from "../live/cryptoExecutionQuotes.js";
import { buildStrategyExecutionPlan } from "../strategies/strategyRouter.js";

test("crypto auto-buy stays on after the stock market closes", () => {
  const plan = buildStrategyExecutionPlan({
    selectedMode: "live_stock",
    effectiveMode: "live_stock",
    marketOpen: false,
    approvedStockCount: 0,
    approvedCryptoCount: 0,
    tradingStoppedForDay: true,
    stockTradingStoppedForDay: true,
    cryptoTradingStoppedForDay: false,
  });
  assert.equal(plan.shouldRunStockAutoBuy, false);
  assert.equal(plan.shouldRunCryptoAutoBuy, true);
});

test("a Finnhub quote does not replace a live Alpaca crypto book", () => {
  const now = Date.parse("2026-09-21T16:00:00.000Z");
  const stamp = new Date(now - 500).toISOString();
  const kept = applyTradeTickWithoutClearingAlpacaBook({
    price: 100,
    bid: 99.9,
    ask: 100.1,
    spreadAvailable: true,
    liveQuoteSource: "alpaca_crypto_ws",
    source: "alpaca_crypto_ws",
    spreadSource: "alpaca_crypto_ws",
    liveQuoteUpdatedAt: stamp,
    spreadUpdatedAt: stamp,
    priceIsLive: true,
  }, {
    price: 101.4,
    liveQuoteSource: "finnhub_ws",
    source: "finnhub_ws",
    liveQuoteUpdatedAt: new Date(now).toISOString(),
    priceIsLive: true,
  });
  assert.equal(kept.liveQuoteSource, "alpaca_crypto_ws");
  assert.equal(kept.bid, 99.9);
  assert.equal(kept.ask, 100.1);
});

test("crypto scan keeps a USD universe when Alpaca trading assets are empty", () => {
  assert.deepEqual(resolveCryptoAssetUniverse({ fetched: [], cached: [] }).slice(0, 3), ["BTC/USD", "ETH/USD", "SOL/USD"]);
  assert.ok(FALLBACK_ALPACA_CRYPTO_USD_PAIRS.includes("BTC/USD"));
  assert.deepEqual(resolveCryptoAssetUniverse({ fetched: ["ETH/USD", "DOGE/USD"] }), ["ETH/USD", "DOGE/USD"]);
  assert.deepEqual(resolveCryptoAssetUniverse({ fetched: [], cached: ["SOL/USD"] }), ["SOL/USD"]);
});
