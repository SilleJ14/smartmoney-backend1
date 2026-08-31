import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateStockCandidateQuoteQuality,
  filterAndRankStockCandidatesByExecutionQuality,
} from "../market-data/stockCandidateQuality.js";

const now = Date.parse("2026-08-31T14:00:00.000Z");

test("rejects stock movers with missing, stale, wide, or thin execution evidence", () => {
  const base = { symbol: "TEST", current: 10, volume: 100_000, percentChange: 4 };
  const goodQuote = {
    symbol: "TEST",
    bid: 9.98,
    ask: 10.02,
    liveQuoteUpdatedAt: "2026-08-31T13:59:58.000Z",
    spreadUpdatedAt: "2026-08-31T13:59:58.000Z",
  };

  assert.equal(evaluateStockCandidateQuoteQuality(base, goodQuote, { now }).accepted, true);
  assert.ok(
    evaluateStockCandidateQuoteQuality(base, { ...goodQuote, bid: 9, ask: 11 }, { now })
      .reasons.includes("SPREAD_TOO_WIDE_FOR_WATCHLIST")
  );
  assert.ok(
    evaluateStockCandidateQuoteQuality(base, { ...goodQuote, bid: 0, ask: 0 }, { now })
      .reasons.includes("TWO_SIDED_QUOTE_UNAVAILABLE")
  );
  assert.ok(
    evaluateStockCandidateQuoteQuality(
      base,
      { ...goodQuote, spreadUpdatedAt: null },
      { now }
    ).reasons.includes("SPREAD_TIMESTAMP_UNAVAILABLE")
  );
  assert.ok(
    evaluateStockCandidateQuoteQuality(
      base,
      { ...goodQuote, liveQuoteUpdatedAt: "2026-08-31T13:55:00.000Z" },
      { now }
    ).reasons.includes("QUOTE_TOO_STALE_FOR_WATCHLIST")
  );
  assert.ok(
    evaluateStockCandidateQuoteQuality(
      { ...base, volume: 100 },
      goodQuote,
      { now }
    ).reasons.includes("DOLLAR_VOLUME_TOO_LOW")
  );
});

test("keeps only executable movers and ranks quote quality ahead of raw percentage move", () => {
  const result = filterAndRankStockCandidatesByExecutionQuality({
    candidates: [
      { symbol: "WIDE", current: 5, volume: 1_000_000, percentChange: 20 },
      { symbol: "GOOD", current: 50, volume: 500_000, percentChange: 3 },
      { symbol: "OKAY", current: 20, volume: 500_000, percentChange: 6 },
    ],
    quotes: [
      { symbol: "WIDE", bid: 4, ask: 6, liveQuoteUpdatedAt: "2026-08-31T13:59:59.000Z", spreadUpdatedAt: "2026-08-31T13:59:59.000Z" },
      { symbol: "GOOD", bid: 49.99, ask: 50.01, liveQuoteUpdatedAt: "2026-08-31T13:59:59.000Z", spreadUpdatedAt: "2026-08-31T13:59:59.000Z" },
      { symbol: "OKAY", bid: 19.9, ask: 20.1, liveQuoteUpdatedAt: "2026-08-31T13:59:40.000Z", spreadUpdatedAt: "2026-08-31T13:59:40.000Z" },
    ],
    normalizeSymbol: (value) => String(value || "").toUpperCase(),
    now,
  });

  assert.equal(result.reviewedCount, 3);
  assert.equal(result.acceptedCount, 2);
  assert.equal(result.rejectedCount, 1);
  assert.deepEqual(result.accepted.map((item) => item.symbol), ["GOOD", "OKAY"]);
  assert.equal(result.rejected[0].symbol, "WIDE");
  assert.equal(result.rejectionCounts.SPREAD_TOO_WIDE_FOR_WATCHLIST, 1);
});
