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

test('after-hours stock research stays active without granting execution or relaxing quote gates', () => {
  assert.equal(canRefreshStockQuotes({ marketOpen: false, marketSession: 'afterhours' }), true);
  const policy = getStockMoverQuotePolicy({ marketOpen: false, marketSession: 'afterhours' });
  assert.equal(policy.session, 'afterhours');
  assert.equal(policy.discoveryOnly, true);
  assert.equal(policy.maxQuoteAgeSeconds, 5);
  assert.equal(policy.maxSpreadPercent, 2);
  for (const marketSession of ['closed', 'unknown', 'regular']) {
    assert.equal(canRefreshStockQuotes({ marketOpen: false, marketSession }), false);
  }
  assert.equal(canRefreshStockQuotes({ marketOpen: true, marketSession: 'regular' }), true);
});
