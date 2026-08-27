import test from "node:test";
import assert from "node:assert/strict";
import { fetchAlpacaStockOutcomeQuotes } from "../market-data/alpacaStockOutcomeQuotes.js";

test("outcome quote follow-up batches symbols and returns only measured quotes", async () => {
  const paths = [];
  const results = await fetchAlpacaStockOutcomeQuotes(
    ["aaa", "BBB", "AAA"],
    {
      dataRequest: async (path) => {
        paths.push(path);
        return {
          quotes: {
            AAA: { bp: 10, ap: 10.1, t: "2026-08-27T14:30:00.000Z" },
            BBB: {},
          },
        };
      },
    }
  );

  assert.equal(paths.length, 1);
  assert.match(paths[0], /AAA%2CBBB/);
  assert.equal(results.length, 1);
  assert.equal(results[0].symbol, "AAA");
  assert.equal(results[0].outcomeFollowupOnly, true);
  assert.equal(results[0].liveQuoteUpdatedAt, "2026-08-27T14:30:00.000Z");
  assert.equal(results[0].quoteTimestampMs, Date.parse("2026-08-27T14:30:00.000Z"));
});

test("outcome quote follow-up rejects quotes without provider timestamps", async () => {
  const results = await fetchAlpacaStockOutcomeQuotes(["AAA"], {
    dataRequest: async () => ({ quotes: { AAA: { bp: 10, ap: 10.1 } } }),
  });

  assert.deepEqual(results, []);
});
