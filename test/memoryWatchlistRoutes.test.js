import test from "node:test";
import assert from "node:assert/strict";
import { buildMemoryStatus, buildWatchlistSnapshot } from "../routes/memoryWatchlistRoutes.js";

test("memory status reports process megabytes and engine counts", () => {
  const result = buildMemoryStatus({ runnerPredictionHistory: [1], liveQuoteCache: { A: {} } }, { rss: 1048576, heapUsed: 0, heapTotal: 0, external: 0 }, "now");
  assert.equal(result.processMemory.rssMb, 1);
  assert.equal(result.engineMemory.runnerPredictionHistory, 1);
  assert.equal(result.engineMemory.liveQuoteSymbols, 1);
});

test("watchlist snapshots enforce response limits", () => {
  const values = Array.from({ length: 60 }, (_, index) => index);
  const result = buildWatchlistSnapshot({ topRunnerWatchlist: values, runnerPredictionHistory: values }, "runner", "now");
  assert.equal(result.topRunnerWatchlist.length, 25);
  assert.equal(result.runnerPredictionHistory.length, 50);
});
