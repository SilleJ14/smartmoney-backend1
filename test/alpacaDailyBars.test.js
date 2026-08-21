import test from "node:test";
import assert from "node:assert/strict";
import { fetchAlpacaGroupedDaily } from "../discovery/alpacaDailyBars.js";

test("Alpaca fallback batches symbols and converts daily bars to grouped rows", async () => {
  const paths = [];
  const result = await fetchAlpacaGroupedDaily({
    symbols: ["AAPL", "MSFT", "NVDA"],
    dateKey: "2026-08-20",
    batchSize: 2,
    maxDownloadBytes: 100000,
    dataRequest: async (path) => {
      paths.push(path);
      const symbols = new URL(`https://example.test${path}`).searchParams.get("symbols").split(",");
      return { bars: Object.fromEntries(symbols.map((symbol) => [symbol, [{ t: "2026-08-20T04:00:00Z", o: 10, h: 11, l: 9, c: 10.5, v: 1000 }]])) };
    },
  });
  assert.equal(paths.length, 2);
  assert.equal(result.groupedResults.length, 3);
  assert.equal(result.requestedSymbols, 3);
  assert.equal(result.returnedSymbols, 3);
  assert.match(paths[0], /timeframe=1Day/);
  assert.match(paths[0], /feed=iex/);
});

test("Alpaca fallback follows pagination and enforces the download budget", async () => {
  let calls = 0;
  await assert.rejects(fetchAlpacaGroupedDaily({
    symbols: ["AAPL"],
    dateKey: "2026-08-20",
    maxDownloadBytes: 30,
    dataRequest: async () => {
      calls += 1;
      return { bars: { AAPL: [{ o: 10, h: 11, l: 9, c: 10.5, v: 1000 }] }, next_page_token: calls === 1 ? "next" : null };
    },
  }), /download budget exceeded/i);
  assert.equal(calls, 1);
});

test("Alpaca fallback excludes a bar outside the requested trading date", async () => {
  const result = await fetchAlpacaGroupedDaily({
    symbols: ["AAPL", "MSFT"],
    dateKey: "2026-08-20",
    maxDownloadBytes: 100000,
    dataRequest: async () => ({ bars: {
      AAPL: [{ t: "2026-08-20T04:00:00Z", o: 10, h: 11, l: 9, c: 10.5, v: 1000 }],
      MSFT: [{ t: "2026-08-21T04:00:00Z", o: 20, h: 21, l: 19, c: 20.5, v: 2000 }],
    } }),
  });
  assert.deepEqual(result.groupedResults.map((row) => row.T), ["AAPL"]);
});

test("Alpaca fallback fails safely instead of replacing the daily store with no bars", async () => {
  await assert.rejects(fetchAlpacaGroupedDaily({
    symbols: ["AAPL"],
    dateKey: "2026-08-20",
    maxDownloadBytes: 100000,
    dataRequest: async () => ({ bars: {} }),
  }), /returned no daily bars/i);
});
