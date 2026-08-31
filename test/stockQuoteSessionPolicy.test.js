import test from "node:test";
import assert from "node:assert/strict";
import {
  canRefreshStockQuotes,
  getStockMoverQuotePolicy,
} from "../market-data/stockQuoteSessionPolicy.js";

test("premarket stock quotes refresh with a discovery-only spread policy", () => {
  assert.equal(canRefreshStockQuotes({ marketOpen: false, marketSession: "premarket" }), true);
  assert.equal(canRefreshStockQuotes({ marketOpen: false, marketSession: "closed" }), false);
  const policy = getStockMoverQuotePolicy({
    marketOpen: false,
    marketSession: "premarket",
    regularMaxSpreadPercent: 1,
    premarketMaxSpreadPercent: 3,
    premarketMaxQuoteAgeSeconds: 30,
  });
  assert.equal(policy.session, "premarket");
  assert.equal(policy.discoveryOnly, true);
  assert.equal(policy.maxSpreadPercent, 3);
  assert.equal(policy.maxQuoteAgeSeconds, 30);
});
