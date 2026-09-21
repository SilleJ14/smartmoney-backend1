import test from "node:test";
import assert from "node:assert/strict";
import {
  isTransientMarketDataError,
  scanWithRateLimitFallback,
} from "../engine/createEngineCycle.js";

test("Alpaca rate limits are treated as transient scan errors", () => {
  assert.equal(isTransientMarketDataError({ status: 429, message: "rate limit exceeded" }), true);
  assert.equal(isTransientMarketDataError(new Error("Polygon rate limit")), true);
  assert.equal(isTransientMarketDataError(new Error("missing keys")), false);
});

test("a rate-limited scan keeps the previous candidate set", async () => {
  const previous = [{ symbol: "LOBO" }];
  const rows = await scanWithRateLimitFallback(async () => {
    throw Object.assign(new Error("rate limit exceeded"), { status: 429 });
  }, previous);
  assert.equal(rows, previous);
});
