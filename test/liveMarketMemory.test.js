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
