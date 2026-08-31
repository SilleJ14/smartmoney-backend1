import test from "node:test";
import assert from "node:assert/strict";
import { classifyStockDiscoveryLane } from "../discovery/stockDiscoveryLanes.js";

test("liquid normal stocks can reach full scoring without a 5x runner profile", () => {
  const result = classifyStockDiscoveryLane({
    symbol: "AAPL",
    volume: 1_000_000,
    relativeVolume: 1.4,
    percentChange: 1.2,
    technicals: { ema9: 202, ema20: 200 },
  });
  assert.equal(result.normalStrong, true);
  assert.equal(result.lane, "NORMAL_STRONG");
});

test("low-volume unstructured stocks do not enter the normal-strong lane", () => {
  const result = classifyStockDiscoveryLane({
    symbol: "THIN",
    volume: 50_000,
    relativeVolume: 1.4,
    percentChange: 1.2,
  });
  assert.equal(result.normalStrong, false);
  assert.equal(result.lane, "EXPLOSIVE_RUNNER");
});
