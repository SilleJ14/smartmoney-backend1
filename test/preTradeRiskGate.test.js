import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluatePreTradeRisk,
  hasMeasuredLiveSpread,
} from "../risk/preTradeRiskGate.js";

function safeContext(overrides = {}) {
  return {
    emergencyStopActive: false,
    realCashTradingUnlocked: true,
    autoTradingEnabled: true,
    dailyLossLocked: false,
    profitLocked: false,
    isCrypto: false,
    marketOpen: true,
    price: 100,
    quoteAgeSeconds: 2,
    spreadPercent: 0.2,
    quoteIsLive: true,
    requireLiveProvider: true,
    liveProviderConnected: true,
    maxQuoteAgeSeconds: 5,
    maxSpreadPercent: 2.5,
    maxExposurePercent: 80,
    maxOpenTrades: 10,
    account: { equity: 1000 },
    positions: [],
    ...overrides,
  };
}

test("approves a healthy automated buy", () => {
  const result = evaluatePreTradeRisk({
    order: { symbol: "AAPL", side: "buy", notional: 25 },
    context: safeContext(),
  });
  assert.equal(result.approved, true);
});

test("combines operational lock reasons", () => {
  const result = evaluatePreTradeRisk({
    order: { symbol: "AAPL", side: "buy", notional: 25 },
    context: safeContext({
      emergencyStopActive: true,
      realCashTradingUnlocked: false,
      autoTradingEnabled: false,
      dailyLossLocked: true,
      profitLocked: true,
    }),
  });
  assert.equal(result.approved, false);
  assert.match(result.reasons.join(" | "), /Emergency stop.*Real cash.*Auto trading.*Daily loss.*Profit lock/);
});

test("rejects stale, non-live, wide-spread quotes", () => {
  const result = evaluatePreTradeRisk({
    order: { symbol: "AAPL", side: "buy", qty: 1 },
    context: safeContext({ quoteAgeSeconds: 30, quoteIsLive: false, spreadPercent: 4 }),
  });
  assert.deepEqual(result.reasons.filter((reason) =>
    /stale|live source|Spread/.test(reason)
  ).length, 3);
});

test("requires the order quote to be no older than five seconds", () => {
  const fiveSeconds = evaluatePreTradeRisk({
    order: { symbol: "AAPL", side: "buy", notional: 25 },
    context: safeContext({ quoteAgeSeconds: 5 }),
  });
  const sixSeconds = evaluatePreTradeRisk({
    order: { symbol: "AAPL", side: "buy", notional: 25 },
    context: safeContext({ quoteAgeSeconds: 6 }),
  });

  assert.equal(fiveSeconds.approved, true);
  assert.equal(sixSeconds.approved, false);
  assert.ok(sixSeconds.reasons.includes("Live quote stale: 6s old"));
});

test("rejects quotes whose timestamps are materially in the future", () => {
  const result = evaluatePreTradeRisk({
    order: { symbol: "AAPL", side: "buy", notional: 25 },
    context: safeContext({ quoteAgeSeconds: -60 }),
  });

  assert.equal(result.approved, false);
  assert.ok(result.reasons.includes("Live quote timestamp is in the future: -60s old"));
});

test("rejects exposure and open-position limit violations", () => {
  const positions = [
    { symbol: "MSFT", market_value: 790 },
    { symbol: "TSLA", market_value: 5 },
  ];
  const result = evaluatePreTradeRisk({
    order: { symbol: "AAPL", side: "buy", notional: 25 },
    context: safeContext({ positions, maxOpenTrades: 2 }),
  });
  assert.match(result.reasons.join(" | "), /Maximum bot exposure exceeded/);
  assert.match(result.reasons.join(" | "), /Maximum open-trade count reached/);
});

test("manual buys may proceed while automation is disabled", () => {
  const result = evaluatePreTradeRisk({
    order: { symbol: "AAPL", side: "buy", notional: 25 },
    context: safeContext({ autoTradingEnabled: false }),
    options: { automated: false },
  });
  assert.equal(result.approved, true);
});

test("sells remain available during emergency and account-data failures", () => {
  const result = evaluatePreTradeRisk({
    order: { symbol: "AAPL", side: "sell", qty: 1 },
    context: safeContext({
      emergencyStopActive: true,
      realCashTradingUnlocked: false,
      account: null,
      quoteIsLive: false,
    }),
  });
  assert.equal(result.approved, true);
});

test("central pre-trade gate enforces strategy position limits only for buys", () => {
  const blocked = evaluatePreTradeRisk({
    order: { symbol: "AAA", side: "buy", notional: 10 },
    options: { automated: false },
    context: {
      realCashTradingUnlocked: true, marketOpen: true, price: 10, quoteIsLive: true,
      quoteAgeSeconds: 1, maxQuoteAgeSeconds: 15, spreadPercent: 0.1,
      account: { equity: 1000 }, maxExposurePercent: 100, positions: [],
      liveTradeLimitDecision: { approved: false, reasons: ["Maximum intraday stock trades reached for today (2)"] },
    },
  });
  assert.equal(blocked.approved, false);
  assert.match(blocked.reasons.join(" "), /Maximum intraday/);
  const sell = evaluatePreTradeRisk({ order: { symbol: "AAA", side: "sell", qty: 1 }, context: { liveTradeLimitDecision: { approved: false, reasons: ["blocked"] } } });
  assert.equal(sell.approved, true);
});

test("automated buys fail closed when a live bid/ask spread is unavailable", () => {
  const result = evaluatePreTradeRisk({
    order: { symbol: "AAPL", side: "buy", notional: 25 },
    context: safeContext({
      spreadPercent: null,
      spreadAvailable: false,
    }),
  });

  assert.equal(result.approved, false);
  assert.ok(result.reasons.includes("Live bid/ask spread is unavailable"));
});

test("live starter spread evidence cannot treat a missing or explicitly unavailable spread as measured", () => {
  assert.equal(hasMeasuredLiveSpread({}), false);
  assert.equal(hasMeasuredLiveSpread({ spreadPercent: 0.12 }), true);
  assert.equal(
    hasMeasuredLiveSpread({ spreadPercent: 0.12, spreadAvailable: false }),
    false
  );
  assert.equal(hasMeasuredLiveSpread({ spreadAvailable: true }), true);
});
