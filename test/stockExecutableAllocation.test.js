import test from "node:test";
import assert from "node:assert/strict";
import { attachStockExecutableAllocation } from "../scoring/stockExecutableAllocation.js";
import { getApprovedTradeAmount } from "../scoring/approvedSizing.js";
import { createIncrementalResearch } from "../discovery/incrementalResearch.js";
import { decisionAuthorization } from "../scoring/decisionAuthorization.js";
import { evaluateStockTradeCandidate } from "../scoring/decisionScores.js";

function liveStock(now = Date.now(), extras = {}) {
  const iso = new Date(now).toISOString();
  return {
    symbol: "AAPL",
    assetClass: "stock",
    stockDecisionScore: 70,
    stockDecisionScoreAvailable: true,
    masterFinalScore: 70,
    current: 100,
    price: 100,
    bid: 99.95,
    ask: 100.05,
    priceIsLive: true,
    liveQuoteUpdatedAt: iso,
    liveQuoteSource: "tradier_stock_quote",
    spreadUpdatedAt: iso,
    spreadSource: "tradier_stock_quote",
    spreadAvailable: true,
    decisionUpdatedAt: iso,
    chartBars: Array.from({ length: 24 }, () => ({ c: 100 })),
    centralAutonomousDecisionCore: { updatedAt: iso, action: "ALLOW" },
    researchEvidenceAt: iso,
    ...extras,
  };
}

const account = {
  equity: 10000,
  cash: 4000,
  buying_power: 4000,
  last_equity: 10000,
};
const config = {
  maxBotExposurePercent: 15,
  minAutonomousTradeAmount: 25,
  dailyLossLimitPercent: 2,
  maxRiskPerTradePercent: 0.5,
  stopLossPercent: 2,
  liveHardStopPercent: 3.5,
};

test("F70 stock with a live Tradier book gets a size and a 5s buy window", () => {
  const now = Date.now();
  const sized = attachStockExecutableAllocation(liveStock(now), { now, account, positions: [], config });
  assert.equal(sized.buyableNow, true);
  assert.ok(sized.finalApprovedTradeAmount >= 25);
  assert.equal(getApprovedTradeAmount(sized) >= 1, true);
  const gate = evaluateStockTradeCandidate(sized, {
    requireCentralDecision: true,
    requireFreshDecision: true,
    requireExplicitApproval: true,
    now,
  });
  const auth = decisionAuthorization(sized, gate, now);
  assert.equal(auth.approved, true);
  assert.ok(Date.parse(auth.expiresAt) > now);
});

test("a locked live account cannot receive automatic stock approval or sizing", () => {
  const now = Date.now();
  const sized = attachStockExecutableAllocation(liveStock(now), {
    now, account, config: { ...config, realCashTradingUnlocked: false },
  });
  assert.equal(sized.approved, false);
  assert.equal(sized.finalApprovedTradeAmount, 0);
  assert.ok(sized.executionEligibility.reasons.includes("REAL_CASH_TRADING_LOCKED"));
});

test("stock F 69 is not buyable", () => {
  const now = Date.now();
  const sized = attachStockExecutableAllocation(liveStock(now, {
    stockDecisionScore: 69,
    masterFinalScore: 69,
  }), { now, account, positions: [], config });
  assert.equal(sized.buyableNow, false);
});

test("incremental research keeps a live stock size instead of wiping it", () => {
  const now = Date.now();
  const published = [];
  const research = createIncrementalResearch({
    now: () => now,
    review: (row) => attachStockExecutableAllocation(row, { now, account, positions: [], config }),
    publish: (rows) => published.push(...rows),
  });
  const result = research.run([liveStock(now)]);
  assert.equal(result.reviewed, 1);
  assert.equal(published[0].buyableNow, true);
  assert.ok(published[0].finalApprovedTradeAmount >= 25);
  assert.equal(published[0].researchOnly, false);
});
