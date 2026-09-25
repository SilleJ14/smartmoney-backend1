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
    entryQualityScore: 80,
    entryQualityScorecard: { approved: true, score: 80, coverage: 1 },
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
    chartTimeframe: "5Min",
    chartBars: Array.from({ length: 24 }, (_, index) => ({
      time: now - (24 - index) * 300000,
      open: 100,
      high: 100.05,
      low: 99.95,
      close: 100,
    })),
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

test("a stale quote keeps a strong F and blocks buyable on execution", () => {
  const now = Date.now();
  const staleAt = new Date(now - 8400).toISOString();
  const sized = attachStockExecutableAllocation(liveStock(now, {
    liveQuoteUpdatedAt: staleAt,
    spreadUpdatedAt: staleAt,
    decisionUpdatedAt: staleAt,
  }), { now, account, positions: [], config });
  assert.equal(sized.opportunityLayers.F, 70);
  assert.equal(sized.opportunityLayers.analyticalPass, true);
  assert.equal(sized.opportunityLayers.X.state, "EXECUTION_NOT_READY");
  assert.equal(sized.opportunityLayers.X.reasons.includes("QUOTE_STALE"), true);
  assert.ok(sized.opportunityLayers.S.amount >= 25);
  assert.equal(sized.opportunityLayers.buyable, false);
  assert.equal(sized.opportunityLayers.blockedBy, "X");
  assert.equal(sized.buyableNow, false);
  assert.equal(sized.finalApprovedTradeAmount, 0);
});

test("missing mandatory news waits on evidence and does not fail F", () => {
  const now = Date.now();
  const sized = attachStockExecutableAllocation(liveStock(now, {
    requireNewsRiskForEntry: true,
    confirmations: { newsRiskAvailable: false },
  }), { now, account, positions: [], config });
  assert.equal(sized.opportunityLayers.F, 70);
  assert.equal(sized.opportunityLayers.C.state, "DATA_UNAVAILABLE");
  assert.equal(sized.opportunityLayers.C.news.state, "NEWS_UNAVAILABLE");
  assert.equal(sized.opportunityLayers.blockedBy, "C");
  assert.equal(sized.buyableNow, false);
});

test("negative news fails evidence only when that strategy requires the news check", () => {
  const now = Date.now();
  const required = attachStockExecutableAllocation(liveStock(now, {
    requireNewsRiskForEntry: true,
    confirmations: { newsRisk: true, newsRiskAvailable: true },
  }), { now, account, positions: [], config });
  assert.equal(required.opportunityLayers.C.state, "REJECT");
  assert.equal(required.opportunityLayers.C.news.state, "NEGATIVE_CATALYST");
  assert.equal(required.opportunityLayers.F, 70);
  const optional = attachStockExecutableAllocation(liveStock(now, {
    requireNewsRiskForEntry: false,
    confirmations: { newsRisk: true, newsRiskAvailable: true },
  }), { now, account, positions: [], config });
  assert.equal(optional.opportunityLayers.C.state, "PASS");
  assert.equal(optional.opportunityLayers.C.news.state, "NEGATIVE_CATALYST");
});

test("portfolio exposure blocks risk without changing F", () => {
  const now = Date.now();
  const sized = attachStockExecutableAllocation(liveStock(now, {
    portfolioAction: "REDUCE_RISK",
  }), { now, account, positions: [], config });
  assert.equal(sized.opportunityLayers.F, 70);
  assert.equal(sized.opportunityLayers.R.state, "REJECT");
  assert.equal(sized.opportunityLayers.R.reasons.includes("PORTFOLIO_EXPOSURE_LIMIT"), true);
  assert.equal(sized.opportunityLayers.blockedBy, "R");
  assert.equal(sized.buyableNow, false);
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
  const result = research.run([liveStock(now, { authorizedDecisionValid: true })]);
  assert.equal(result.reviewed, 1);
  assert.equal(published[0].buyableNow, true);
  assert.ok(published[0].finalApprovedTradeAmount >= 25);
  assert.equal(published[0].researchOnly, false);
});
