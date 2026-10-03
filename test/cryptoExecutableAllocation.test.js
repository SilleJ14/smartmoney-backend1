import test from "node:test";
import assert from "node:assert/strict";
import { attachCryptoExecutableAllocation } from "../scoring/cryptoExecutableAllocation.js";
import { isSizingRevoked, getApprovedTradeAmount } from "../scoring/approvedSizing.js";
import { createIncrementalResearch } from "../discovery/incrementalResearch.js";
import { decisionAuthorization } from "../scoring/decisionAuthorization.js";
import { evaluateCryptoTradeCandidate } from "../scoring/componentScore.js";
import { cryptoSetupEvidence } from './fixtures/cryptoSetupFixture.js';

function liveBtc(now = Date.now(), extras = {}) {
  const iso = new Date(now).toISOString();
  return {
    symbol: "BTC/USD",
    ...cryptoSetupEvidence(100, now),
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
    cryptoContextScorecard: { score: 50, independent: true, source: "independent_test_context" },
    cryptoMarketContext: { score: 50, state: "NEUTRAL", measuredAt: iso, affectsF: false },
    centralAutonomousDecisionCore: { updatedAt: iso, action: "ALLOW", cryptoDecisionEvidence: { coreEvidencePass: true } },
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
  assert.equal(sized.buyableNow, true, JSON.stringify({
    reasons: sized.executionEligibility?.reasons,
    shadow: sized.cryptoAnalyticalShadow,
  }));
  assert.ok(sized.finalApprovedTradeAmount >= 25);
  assert.equal(sized.sizingDecisionUpdatedAt, sized.decisionUpdatedAt);
  assert.equal(getApprovedTradeAmount(sized) >= 1, true);
  const gate = evaluateCryptoTradeCandidate(sized, { now });
  const auth = decisionAuthorization(sized, gate, now);
  assert.equal(auth.approved, true);
  assert.ok(Date.parse(auth.expiresAt) > now);
});

test("a locked live account cannot receive automatic crypto approval or sizing", () => {
  const now = Date.now();
  const sized = attachCryptoExecutableAllocation(liveBtc(now), {
    now, account, config: { ...config, realCashTradingUnlocked: false },
  });
  assert.equal(sized.approved, false);
  assert.equal(sized.finalApprovedTradeAmount, 0);
  assert.ok(sized.executionEligibility.reasons.includes("REAL_CASH_TRADING_LOCKED"));
});

test("zero frontend exposure disables crypto sizing without falling back to a default", () => {
  const now = Date.now();
  const sized = attachCryptoExecutableAllocation(liveBtc(now), {
    now, account, positions: [], config: { ...config, maxBotExposurePercent: 0 },
  });
  assert.equal(sized.buyableNow, false);
  assert.equal(sized.finalApprovedTradeAmount, 0);
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

test("an unsized coin is judged at the minimum order size, not stuck waiting for a size", async () => {
  const { buildCryptoDecisionScore } = await import("../scoring/componentScore.js");
  const { liveCryptoPermission } = await import("../scoring/cryptoAnalyticalShadow.js");
  const { cryptoDecisionInput } = await import("../scoring/cryptoExecutableAllocation.js");
  const now = Date.now();
  const unsized = liveBtc(now, { intendedNotional: null, finalApprovedTradeAmount: null, recommendedTradeAmount: null });
  const withoutSize = liveCryptoPermission(buildCryptoDecisionScore(unsized, { now }).cryptoAnalyticalShadow);
  assert.equal(withoutSize.allowed, false);
  assert.ok(withoutSize.reasons.includes("INTENDED_NOTIONAL_UNKNOWN"), JSON.stringify(withoutSize.reasons));
  const decision = cryptoDecisionInput(unsized, config);
  assert.equal(decision.provisionalNotional, config.minCryptoTradeAmount);
  assert.equal(unsized.intendedNotional, null, "the live signal is never given the provisional size");
  const atMinimum = liveCryptoPermission(buildCryptoDecisionScore(decision.input, { now }).cryptoAnalyticalShadow);
  assert.equal(atMinimum.allowed, true, JSON.stringify(atMinimum.reasons));
  // A $0 minimum must not bring the deadlock back.
  const zeroMinimum = cryptoDecisionInput(unsized, { ...config, minCryptoTradeAmount: 0 });
  assert.equal(zeroMinimum.provisionalNotional, 1);
  assert.equal(liveCryptoPermission(buildCryptoDecisionScore(zeroMinimum.input, { now }).cryptoAnalyticalShadow).allowed, true);
  assert.equal(cryptoDecisionInput(unsized, {}).provisionalNotional, 25);
  // An already sized coin is judged at its own size.
  const sizedCoin = liveBtc(now, { intendedNotional: 400 });
  assert.equal(cryptoDecisionInput(sizedCoin, config).input, sizedCoin);
  assert.equal(cryptoDecisionInput(sizedCoin, config).provisionalNotional, null);
  const fs = await import("node:fs");
  assert.ok(fs.readFileSync(new URL("../server.js", import.meta.url), "utf8").includes("cryptoDecisionInput(signal, CONFIG)"),
    "the central decision must use cryptoDecisionInput");
});

test("a size from an earlier decision does not stop the coin being sized for the new one", () => {
  const first = Date.now() - 30_000;
  const sized = attachCryptoExecutableAllocation(liveBtc(first), { now: first, account, positions: [], config });
  assert.ok(getApprovedTradeAmount(sized) > 0);
  // Next cycle: a new central decision is installed; the old size keeps its old stamp.
  const now = Date.now();
  sized.decisionUpdatedAt = new Date(now).toISOString();
  Object.assign(sized, { liveQuoteUpdatedAt: sized.decisionUpdatedAt, spreadUpdatedAt: sized.decisionUpdatedAt });
  sized.cryptoOrderbook = { ...sized.cryptoOrderbook, updatedAt: sized.decisionUpdatedAt };
  assert.equal(isSizingRevoked(sized), true);
  const resized = attachCryptoExecutableAllocation(sized, { now, account, positions: [], config });
  assert.equal(isSizingRevoked(resized), false);
  assert.ok(getApprovedTradeAmount(resized) > 0, JSON.stringify(resized.executionEligibility?.reasons));
  assert.equal(resized.buyableNow, true);
});

test("the allocator re-sizes over its own $0 block but respects other sizing blocks", () => {
  const now = Date.now();
  const ownBlock = liveBtc(now, { finalApprovedTradeAmount: 0, finalTradeAmount: 0, recommendedTradeAmount: 0,
    sizingDecisionUpdatedAt: new Date(now).toISOString(),
    finalSizingReconciliation: { finalTradeAmount: 0, finalBlocked: true, basis: "CRYPTO_ANALYTICAL_XRS_LIVE_QUOTE" } });
  ownBlock.sizingDecisionUpdatedAt = ownBlock.decisionUpdatedAt;
  const resized = attachCryptoExecutableAllocation(ownBlock, { now, account, positions: [], config });
  assert.ok(getApprovedTradeAmount(resized) > 0, JSON.stringify(resized.executionEligibility?.reasons));
  const externalBlock = liveBtc(now, {
    finalSizingReconciliation: { finalTradeAmount: 0, finalBlocked: true, basis: "PORTFOLIO_GOVERNOR" } });
  const blocked = attachCryptoExecutableAllocation(externalBlock, { now, account, positions: [], config });
  assert.equal(blocked.buyableNow, false);
  assert.equal(getApprovedTradeAmount(blocked), 0);
  assert.ok(blocked.executionEligibility.reasons.includes("SIZING_BLOCKED"), JSON.stringify(blocked.executionEligibility.reasons));
});
