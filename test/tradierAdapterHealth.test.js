import test from "node:test";
import assert from "node:assert/strict";
import { createTradierMarketData } from "../providers/tradierMarketData.js";

const now = Date.parse("2026-10-02T14:00:00.000Z");
const headers = { get: () => null };

test("Tradier authentication failures are measured instead of reported healthy", async () => {
  const adapter = createTradierMarketData({
    apiKey: "test-key",
    now: () => now,
    fetchImpl: async () => ({
      ok: false,
      status: 401,
      headers,
      json: async () => ({}),
    }),
  });
  assert.deepEqual(await adapter.getLatestQuotes(["AAPL"]), []);
  const status = adapter.getStatus();
  assert.equal(status.authentication.state, "FAIL");
  assert.equal(status.quote.state, "DEGRADED");
  assert.equal(status.entitlement.marketData, "UNKNOWN");
  assert.equal(status.lastHttpStatus, 401);
});

test("Tradier sandbox success remains explicitly delayed and non-live", async () => {
  const adapter = createTradierMarketData({
    apiKey: "test-key",
    sandbox: true,
    now: () => now,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers,
      json: async () => ({
        quotes: {
          quote: {
            symbol: "AAPL",
            type: "stock",
            last: 100,
            trade_date: now,
            bid: 99.9,
            ask: 100.1,
            bid_date: now,
            ask_date: now,
          },
        },
      }),
    }),
  });
  const [quote] = await adapter.getLatestQuotes(["AAPL"]);
  assert.equal(quote.delayed, true);
  assert.equal(quote.priceIsLive, false);
  assert.equal(quote.spreadAvailable, false);
  const status = adapter.getStatus();
  assert.equal(status.authentication.state, "PASS");
  assert.equal(status.entitlement.marketData, "DELAYED");
  assert.equal(status.quote.state, "HEALTHY");
});
