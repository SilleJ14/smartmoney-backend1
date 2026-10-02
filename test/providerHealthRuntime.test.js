import test from "node:test";
import assert from "node:assert/strict";
import { stockDataHealth, symbolEvidenceFromHealth } from "../market-data/providerHealth.js";

test("provider health reports measured authentication and entitlement states", () => {
  const health = stockDataHealth({
    tradier: {
      authentication: { state: "FAIL" },
      entitlement: { marketData: "UNKNOWN" },
      quote: { state: "DEGRADED" },
    },
    massive: { delayed: true },
    alpaca: {
      authentication: { state: "UNKNOWN" },
      stockFeedEntitlement: "IEX",
    },
  }).stocks;
  assert.equal(health.tradier.authentication.state, "FAIL");
  assert.equal(health.tradier.entitlement.marketData, "UNKNOWN");
  assert.equal(health.tradier.quote.state, "DEGRADED");
  assert.equal(health.massive.feed, "DELAYED");
  assert.equal(health.alpaca.authentication.state, "UNKNOWN");
  assert.equal(health.alpaca.stockFeedEntitlement, "IEX");
});

test("healthy infrastructure does not fabricate per-symbol evidence", () => {
  assert.deepEqual(symbolEvidenceFromHealth({
    providerHealthy: true,
    quoteReceived: false,
  }), {
    state: "DATA_UNAVAILABLE",
    reason: "QUOTE_NOT_RECEIVED",
    score: null,
  });
});
