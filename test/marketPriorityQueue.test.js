import test from "node:test";
import assert from "node:assert/strict";
import { createMarketPriorityQueue, sampleExplorationCandidates } from "../discovery/marketPriorityQueue.js";
import { createStockQuoteBatch } from "../market-data/stockQuoteBatch.js";

const mover = (symbol, percentChange, volume = 200000) => ({ symbol, percentChange, volume, price: 10 });

test("deep jobs follow priority and an open position does not take a mover seat", () => {
  const queue = createMarketPriorityQueue({ workerCapacity: 4 });
  const now = Date.now();
  queue.sync({
    now,
    cheapMovers: [mover("AAA", 1), mover("BBB", 3), mover("CCC", 2), mover("DDD", 4), mover("EEE", 0.5)],
    openPositionSymbols: ["OPEN"],
    exploration: [mover("EXP", 0.1, 80000)],
  });
  const jobs = queue.nextDeepJobs(4, now);
  assert.equal(jobs.includes("OPEN"), true);
  assert.equal(jobs.includes("EXP"), true);
  assert.equal(jobs.filter((symbol) => symbol !== "OPEN" && symbol !== "EXP").length, 3);
  assert.equal(jobs.includes("DDD"), true);
  assert.equal(jobs.includes("BBB"), true);
  assert.equal(jobs.includes("CCC"), true);
  assert.equal(jobs.includes("AAA"), false);
});

test("waiting raises priority ahead of a newer stronger mover", () => {
  const queue = createMarketPriorityQueue();
  const start = Date.now();
  queue.sync({ now: start, cheapMovers: [mover("OLD", 1)] });
  queue.sync({ now: start + 45000, cheapMovers: [mover("OLD", 1), mover("NEW", 6)] });
  const jobs = queue.nextDeepJobs(1, start + 45000);
  assert.equal(jobs[0], "OLD");
});

test("a Tradier acceleration raises priority without a new scan rotation", () => {
  const queue = createMarketPriorityQueue();
  const now = Date.now();
  queue.sync({ now, cheapMovers: [mover("FAST", 1), mover("SLOW", 2)] });
  queue.subscriptionSymbols(10);
  queue.noteTradierQuote({
    symbol: "FAST", type: "stock", liveQuoteSource: "tradier_stock_quote", price: 10,
    percentChange: 1, volume: 200000, liveQuoteUpdatedAt: new Date(now).toISOString(), receivedAt: new Date(now).toISOString(),
  }, now);
  queue.noteTradierQuote({
    symbol: "FAST", type: "stock", liveQuoteSource: "tradier_stock_quote", price: 10.4, bid: 10.39, ask: 10.41,
    percentChange: 4, volume: 400000, liveQuoteUpdatedAt: new Date(now + 1000).toISOString(), receivedAt: new Date(now + 1000).toISOString(),
    spreadSource: "tradier_stock_quote", last: 10.4,
  }, now + 1000);
  const jobs = queue.nextDeepJobs(1, now + 1000);
  assert.equal(jobs[0], "FAST");
  const evidence = queue.applyEvidence({ symbol: "FAST", price: 99, current: 99, bid: 1, ask: 2 });
  assert.equal(evidence.price, 10.4);
  assert.equal(evidence.quoteSource, "TRADIER");
  assert.equal(evidence.spreadSource, "TRADIER");
  assert.equal(evidence.tradeSource, "TRADIER");
  assert.equal(evidence.discoverySource, "MASSIVE");
  assert.equal(evidence.executionBroker, "ALPACA");
  assert.equal(evidence.bid, 10.39);
});

test("debug status shows queue position, wait, and worker capacity", () => {
  const queue = createMarketPriorityQueue();
  const now = Date.now();
  queue.sync({ now: now - 8700, cheapMovers: [mover("AAPL", 2), mover("MSFT", 1)] });
  queue.subscriptionSymbols(10);
  const status = queue.publicStatus(now);
  const aapl = status.rows.find((row) => row.symbol === "AAPL");
  assert.equal(aapl.status, "DEEP_SCORE_PENDING");
  assert.equal(aapl.queuePosition, 1);
  assert.equal(aapl.waitingSeconds, 8.7);
  assert.equal(aapl.tradierQuote, "SUBSCRIBED");
  assert.equal(aapl.priorityReason, "WORKER_CAPACITY");
  queue.nextDeepJobs(1, now);
  queue.finish("AAPL", { durationMs: 120, scored: true, now: now + 120 });
  const measured = queue.publicStatus(now + 120);
  assert.equal(measured.deepScoreDurationP50, 120);
  assert.equal(measured.jobsCompletedPerMinute, 1);
  assert.ok(measured.queueWaitP50 >= 0);
});

test("names that leave the cheap band expire visibly and monitors stay subscribed first", () => {
  const queue = createMarketPriorityQueue();
  const now = Date.now();
  queue.sync({ now, cheapMovers: [mover("GONE", 2)], openPositionSymbols: ["HOLD"] });
  queue.sync({ now: now + 1000, cheapMovers: [], openPositionSymbols: ["HOLD"] });
  const status = queue.publicStatus(now + 1000);
  assert.equal(status.jobsExpired, 1);
  assert.equal(status.rows.some((row) => row.symbol === "GONE"), false);
  assert.deepEqual(queue.subscriptionSymbols(1), ["HOLD"]);
});

test("a present Tradier quote is not replaced by an Alpaca fallback", async () => {
  const now = Date.now();
  const tradier = {
    symbol: "AAPL", price: 10, current: 10, bid: 9.99, ask: 10.01, spreadAvailable: true,
    liveQuoteSource: "tradier_stock_quote", spreadSource: "tradier_stock_quote",
    liveQuoteUpdatedAt: new Date(now - 6000).toISOString(), spreadUpdatedAt: new Date(now - 6000).toISOString(),
  };
  const batch = createStockQuoteBatch({
    primary: async () => [tradier],
    fallback: async () => [{ symbol: "AAPL", price: 50, current: 50, bid: 49, ask: 51, spreadAvailable: true, liveQuoteSource: "alpaca_iex", liveQuoteUpdatedAt: new Date(now).toISOString(), spreadUpdatedAt: new Date(now).toISOString() }],
    normalizeSymbol: (value) => String(value || "").toUpperCase(),
    now: () => now,
  });
  const [row] = await batch(["AAPL"]);
  assert.equal(row.price, 10);
  assert.equal(row.liveQuoteSource, "tradier_stock_quote");
});

test("a weak Tradier subscription yields to a stronger mover after its dwell", () => {
  const queue = createMarketPriorityQueue();
  const start = Date.parse("2026-09-25T14:00:00Z");
  queue.sync({ now: start, cheapMovers: [mover("LOW", 0.2)] });
  assert.deepEqual(queue.subscriptionSymbols(1, start), ["LOW"]);
  queue.sync({ now: start + 1000, cheapMovers: [mover("LOW", 0.2), mover("HIGH", 8)] });
  assert.deepEqual(queue.subscriptionSymbols(1, start + 1000), ["LOW"]);
  assert.deepEqual(queue.subscriptionSymbols(1, start + 61000), ["HIGH"]);
});

test("exploration sample stays small", () => {
  const rows = Array.from({ length: 100 }, (_, index) => ({ symbol: `S${index}`, price: 10, volume: 80000 }));
  assert.equal(sampleExplorationCandidates(rows, ["S0"], 5).length, 5);
});
