import test from "node:test";
import assert from "node:assert/strict";
import { attachCryptoExecutableAllocation } from "../scoring/cryptoExecutableAllocation.js";
import { isSizingRevoked, getApprovedTradeAmount } from "../scoring/approvedSizing.js";
import { createIncrementalResearch } from "../discovery/incrementalResearch.js";
import { decisionAuthorization } from "../scoring/decisionAuthorization.js";
import { evaluateCryptoTradeCandidate } from "../scoring/componentScore.js";

function liveBtc(now = Date.now(), extras = {}) {
  const iso = new Date(now).toISOString();
  return {
    symbol: "BTC/USD",
    assetClass: "crypto",
    cryptoDecisionScore: 66,
    cryptoDecisionScoreAvailable: true,
    masterFinalScore: 66,
    current: 100,
    price: 100,
    bid: 99.95,
    ask: 100.05,
    priceIsLive: true,
    liveQuoteUpdatedAt: iso,
    liveQuoteSource: "alpaca_crypto_latest",
    spreadUpdatedAt: iso,
    spreadSource: "alpaca_crypto_latest",
    spreadAvailable: true,
    decisionUpdatedAt: iso,
    cryptoDiscoveryScorecard: {
      score: 67,
      coverage: 1,
      calculatedAt: iso,
      extension: { alreadyExtended: false },
    },
    newsCatalyst: { dataAvailable: true, riskDetected: false },
    barsFound: 30,
    windowDollarVolume: 1_000_000,
    chartBars: Array.from({ length: 24 }, () => ({ c: 100 })),
    centralAutonomousDecisionCore: { updatedAt: iso, action: "WATCH" },
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
  minCryptoTradeAmount: 25,
  minAutonomousTradeAmount: 25,
  dailyLossLimitPercent: 2,
  maxRiskPerTradePercent: 0.5,
  stopLossPercent: 2,
  liveHardStopPercent: 3.5,
};

test("zero research size is pending, not a revoked crypto buy", () => {
  assert.equal(isSizingRevoked({
    recommendedTradeAmount: 0,
    finalApprovedTradeAmount: 0,
    decisionUpdatedAt: "2026-09-21T19:00:00.000Z",
  }), false);
  assert.equal(isSizingRevoked({
    decisionUpdatedAt: "2026-09-21T19:00:00.000Z",
    sizingDecisionUpdatedAt: "2026-09-21T18:00:00.000Z",
  }), true);
});

test("F66 BTC with a live Alpaca book gets a size and a 5s buy window", () => {
  const now = Date.now();
  const sized = attachCryptoExecutableAllocation(liveBtc(now), { now, account, positions: [], config });
  assert.equal(sized.buyableNow, true);
  assert.ok(sized.finalApprovedTradeAmount >= 25);
  assert.equal(sized.sizingDecisionUpdatedAt, sized.decisionUpdatedAt);
  assert.equal(getApprovedTradeAmount(sized) >= 1, true);
  const gate = evaluateCryptoTradeCandidate(sized, { now });
  const auth = decisionAuthorization(sized, gate, now);
  assert.equal(auth.approved, true);
  assert.ok(Date.parse(auth.expiresAt) > now);
});

test("Finnhub still cannot make BTC buyable", () => {
  const now = Date.now();
  const sized = attachCryptoExecutableAllocation(liveBtc(now, {
    liveQuoteSource: "finnhub_ws",
    spreadSource: "finnhub_ws",
  }), { now, account, positions: [], config });
  assert.equal(sized.buyableNow, false);
  assert.equal(evaluateCryptoTradeCandidate(sized, { now }).approved, false);
});

test("incremental research keeps a live crypto size instead of wiping it", () => {
  const now = Date.now();
  const published = [];
  const research = createIncrementalResearch({
    now: () => now,
    review: (row) => attachCryptoExecutableAllocation(row, { now, account, positions: [], config }),
    publish: (rows) => published.push(...rows),
  });
  const result = research.run([liveBtc(now)]);
  assert.equal(result.reviewed, 1);
  assert.equal(published[0].buyableNow, true);
  assert.ok(published[0].finalApprovedTradeAmount >= 25);
  assert.equal(published[0].researchOnly, false);
});
