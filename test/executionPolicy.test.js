import test from "node:test";
import assert from "node:assert/strict";
import { evaluatePreTradeRisk } from "../risk/preTradeRiskGate.js";
import { createMarketPriorityQueue } from "../discovery/marketPriorityQueue.js";
import {
  applyNewsEvent,
  classifyCryptoExecution,
  classifyQuotePurpose,
  classifyStockExecution,
  discoverySpreadAllowsWatch,
  evidenceAgeMs,
  pipelineLatency,
  streamTiming,
} from "../scoring/executionPolicy.js";

const now = Date.parse("2026-09-25T14:00:00.000Z");

function orderContext(overrides = {}) {
  return {
    emergencyStopActive: false,
    realCashTradingUnlocked: true,
    autoTradingEnabled: true,
    dailyLossLocked: false,
    profitLocked: false,
    isCrypto: false,
    marketOpen: true,
    price: 100,
    quoteAgeSeconds: 1,
    spreadPercent: 0.2,
    quoteIsLive: true,
    requireLiveProvider: false,
    maxQuoteAgeSeconds: 5,
    maxSpreadPercent: 1,
    maxExposurePercent: 80,
    account: { equity: 1000, cash: 1000, buying_power: 1000 },
    positions: [],
    ...overrides,
  };
}

test("a 14-second cached stock quote can display but cannot execute", () => {
  const measuredAt = new Date(now - 14000).toISOString();
  const use = classifyQuotePurpose({
    measuredAt,
    cacheStoredAt: new Date(now - 1000).toISOString(),
    now,
  });
  assert.equal(use.quoteAgeMs, 14000);
  assert.equal(use.purposes.DISPLAY, true);
  assert.equal(use.purposes.EXECUTION, false);
  assert.equal(use.usedCacheInsertionTime, false);
});

test("freshness uses the provider timestamp, not cache insertion time", () => {
  const age = evidenceAgeMs({ measuredAt: new Date(now - 14000).toISOString(), now });
  assert.equal(age.evidenceAgeMs, 14000);
  assert.equal(age.usedCacheInsertionTime, false);
});

test("stock spread 1.01 percent and a 5.1 second quote block execution without changing F", () => {
  const wide = classifyStockExecution({
    quoteAgeMs: 1000,
    spreadAgeMs: 1000,
    spreadPercent: 1.01,
    quoteConsolidated: true,
  });
  const stale = classifyStockExecution({
    quoteAgeMs: 5100,
    spreadAgeMs: 1000,
    spreadPercent: 0.2,
    quoteConsolidated: true,
  });
  assert.equal(wide.state, "EXECUTION_NOT_READY");
  assert.equal(wide.reason, "SPREAD_TOO_WIDE");
  assert.equal(wide.changesFinalScore, false);
  assert.equal(stale.reason, "QUOTE_STALE");
  assert.equal(stale.changesFinalScore, false);
});

test("crypto spread 0.86 percent blocks execution without changing F", () => {
  const wide = classifyCryptoExecution({ spreadPercent: 0.86 });
  assert.equal(wide.state, "EXECUTION_NOT_READY");
  assert.equal(wide.reason, "SPREAD_TOO_WIDE");
  assert.equal(wide.changesFinalScore, false);
  assert.equal(classifyCryptoExecution({ spreadPercent: 0.85 }).state, "PASS");
});

test("a missing spread policy cannot fall back to 2.5 percent", () => {
  const missing = evaluatePreTradeRisk({
    order: { symbol: "AAPL", side: "buy", notional: 25 },
    context: orderContext({ maxSpreadPercent: undefined, spreadPercent: 2 }),
  });
  assert.equal(missing.approved, false);
  assert.ok(missing.reasons.includes("POLICY_MISSING"));
  assert.equal(missing.reasons.some((reason) => reason.includes("2.5")), false);
});

test("a 1.8 percent discovery spread can stay visible and still cannot execute", () => {
  assert.equal(discoverySpreadAllowsWatch(1.8), true);
  const execution = classifyStockExecution({
    quoteAgeMs: 1000,
    spreadAgeMs: 1000,
    spreadPercent: 1.8,
    quoteConsolidated: true,
  });
  assert.equal(execution.state, "EXECUTION_NOT_READY");
  assert.equal(execution.reason, "SPREAD_TOO_WIDE");
});

test("a real-time mover enters the queue without the five-minute scan", () => {
  const history = { cachedAt: now - 30 * 60 * 1000, bars: [{ close: 10 }] };
  const queue = createMarketPriorityQueue();
  const delayed = queue.ingestRealtimeMover({
    symbol: "LATE",
    realtime: false,
    timing: "DELAYED",
    measuredAt: new Date(now).toISOString(),
  }, now);
  assert.equal(delayed.accepted, false);
  const accepted = queue.ingestRealtimeMover({
    symbol: "RUN",
    realtime: true,
    percentChange: 4,
    volume: 200000,
    measuredAt: new Date(now - 800).toISOString(),
  }, now);
  assert.equal(accepted.accepted, true);
  assert.equal(accepted.waitedForSwingScan, false);
  assert.equal(queue.publicStatus(now).rows.some((row) => row.symbol === "RUN"), true);
  assert.equal(history.cachedAt, now - 30 * 60 * 1000);
});

test("a Tradier quote refreshes execution age from the provider timestamp", () => {
  const queue = createMarketPriorityQueue();
  queue.ingestRealtimeMover({
    symbol: "RUN",
    realtime: true,
    percentChange: 3,
    volume: 100000,
    measuredAt: new Date(now - 1000).toISOString(),
  }, now);
  const row = queue.noteTradierQuote({
    symbol: "RUN",
    liveQuoteSource: "tradier_stock_quote",
    price: 20,
    bid: 19.99,
    ask: 20.01,
    liveQuoteUpdatedAt: new Date(now - 2400).toISOString(),
    receivedAt: new Date(now).toISOString(),
  }, now);
  assert.equal(row.executionEvidenceAgeMs, 2400);
});

test("delayed market data is not realtime and a long cache is not execution evidence", () => {
  assert.equal(streamTiming("wss://delayed.polygon.io/stocks").realtime, false);
  assert.equal(streamTiming("wss://socket.polygon.io/stocks").timing, "REALTIME");
  const cached = classifyQuotePurpose({
    measuredAt: new Date(now - 20000).toISOString(),
    cacheStoredAt: new Date(now - 500).toISOString(),
    now,
  });
  assert.equal(cached.purposes.EXECUTION, false);
  assert.equal(cached.quoteAgeMs, 20000);
});

test("a news event updates evidence without waiting for the ten-minute poll", () => {
  const cache = { at: now - 10 * 60 * 1000, articles: [{ headline: "old" }], available: true };
  const next = applyNewsEvent(cache, {
    measuredAt: new Date(now).toISOString(),
    article: { headline: "offering" },
  }, now);
  assert.equal(next.waitedForPoll, false);
  assert.equal(next.at, now);
  assert.equal(next.articles[0].headline, "offering");
});

test("pipeline diagnostics keep discovery, scoring, and execution age apart", () => {
  const latency = pipelineLatency({
    discoveredAt: new Date(now - 4000).toISOString(),
    deepScoredAt: new Date(now - 1500).toISOString(),
    measuredAt: new Date(now - 900).toISOString(),
    now,
  });
  assert.equal(latency.discoveryLatencyMs, 4000);
  assert.equal(latency.deepScoreLatencyMs, 2500);
  assert.equal(latency.executionEvidenceAgeMs, 900);
});
