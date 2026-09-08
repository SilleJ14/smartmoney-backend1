import test from "node:test";
import assert from "node:assert/strict";
import { updateLiveMarketMemory } from "../live/liveMarketMemory.js";

test("live market memory ignores out-of-order provider ticks", () => {
  const engineState = { liveMarketMemory: {}, marketOpen: true };
  const options = {
    engineState,
    normalizeSymbol: (symbol) => String(symbol || "").toUpperCase(),
    getMarketSession: () => "regular",
    maxSecondCandles: 20,
  };
  const newer = updateLiveMarketMemory("AAPL", {
    price: 101,
    volume: 10,
    liveQuoteUpdatedAt: "2026-08-31T14:00:05.000Z",
    source: "polygon_ws_trade",
  }, options);
  const older = updateLiveMarketMemory("AAPL", {
    price: 99,
    volume: 500,
    liveQuoteUpdatedAt: "2026-08-31T14:00:04.000Z",
    source: "polygon_ws_trade",
  }, options);

  assert.equal(older, newer);
  assert.equal(engineState.liveMarketMemory.AAPL.price, 101);
  assert.equal(
    engineState.liveMarketMemory.AAPL.updatedAt,
    "2026-08-31T14:00:05.000Z"
  );
  assert.equal(engineState.liveMarketMemory.AAPL.tickWindow.length, 1);
});

test("live market memory preserves measured change when a quote has no baseline", () => {
  const engineState = { liveMarketMemory: {}, marketOpen: true };
  const options = {
    engineState,
    normalizeSymbol: (symbol) => String(symbol || "").toUpperCase(),
    getMarketSession: () => "regular",
    maxSecondCandles: 20,
  };
  updateLiveMarketMemory("BTC/USD", {
    price: 105,
    percentChange: 5,
    percentChangeAvailable: true,
    liveQuoteUpdatedAt: "2026-08-31T14:00:00.000Z",
  }, options);
  const memory = updateLiveMarketMemory("BTC/USD", {
    price: 106,
    percentChange: null,
    percentChangeAvailable: false,
    liveQuoteUpdatedAt: "2026-08-31T14:00:01.000Z",
  }, options);

  assert.equal(memory.livePercentChange, 5);
  assert.equal(memory.livePercentChangeAvailable, true);
});

test("live market memory accepts explicit and baseline-derived measured zero", () => {
  const engineState = { liveMarketMemory: {}, marketOpen: true };
  const options = {
    engineState,
    normalizeSymbol: (symbol) => String(symbol || "").toUpperCase(),
    getMarketSession: () => "regular",
    maxSecondCandles: 20,
  };
  const explicitZero = updateLiveMarketMemory("ETH/USD", {
    price: 100,
    percentChange: 0,
    percentChangeAvailable: true,
    liveQuoteUpdatedAt: "2026-08-31T14:00:00.000Z",
  }, options);
  const baselineZero = updateLiveMarketMemory("BTC/USD", {
    price: 100,
    previousClose: 100,
    percentChange: null,
    percentChangeAvailable: false,
    liveQuoteUpdatedAt: "2026-08-31T14:00:00.000Z",
  }, options);

  assert.equal(explicitZero.livePercentChange, 0);
  assert.equal(explicitZero.livePercentChangeAvailable, true);
  assert.equal(baselineZero.livePercentChange, 0);
  assert.equal(baselineZero.livePercentChangeAvailable, true);
});
