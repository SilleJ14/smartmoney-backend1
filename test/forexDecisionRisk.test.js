import test from "node:test";
import assert from "node:assert/strict";
import {
  scoreForexOpportunity,
  estimateComparableSetupProbability,
  calculateForexExpectedValue,
  decideForexAction,
} from "../forex/forexDecision.js";
import {
  pairReturnCorrelation,
  calculateCurrencyLegExposure,
  progressiveDrawdownMultiplier,
  assessPortfolioRisk,
} from "../forex/portfolioRisk.js";

test("opportunity score reports coverage and is not a probability", () => {
  const score = scoreForexOpportunity({
    trend: { value: 90, weight: 2 },
    structure: { value: 70, weight: 1 },
    sentiment: { value: null, weight: 1, missingReason: "SENTIMENT_STALE" },
  });
  assert.equal(score.score, 250 / 3);
  assert.equal(score.coverage, 0.75);
  assert.deepEqual(score.missingReasons, ["SENTIMENT_STALE"]);
  assert.equal(score.meaning, "RANKING_ONLY_NOT_PROBABILITY");

  const outcomes = Array.from({ length: 20 }, (_, index) => ({
    bucket: "trend-liquid",
    success: index < 9,
    resolvedAt: `2026-01-${String(index + 1).padStart(2, "0")}T00:00:00Z`,
  }));
  const estimate = estimateComparableSetupProbability({
    outcomes,
    bucket: "trend-liquid",
    cutoff: "2026-02-01T00:00:00Z",
    minimumSamples: 20,
    priorAlpha: 1,
    priorBeta: 1,
    calibration: {
      outOfSample: true,
      points: [{ predicted: 0, observed: 0.1 }, { predicted: 1, observed: 0.9 }],
    },
  });
  assert.equal(estimate.empiricalProbability, 10 / 22);
  assert.ok(estimate.probability < 1);
  assert.notEqual(score.score / 100, estimate.probability);
  assert.equal(estimate.source, "BUCKETED_HISTORICAL_OUTCOMES_BETA_BINOMIAL");
});

test("probability enforces time cutoff, sample minimum, and OOS calibration", () => {
  const outcomes = [
    { bucket: "A", success: true, resolvedAt: "2026-01-01T00:00:00Z" },
    { bucket: "A", success: false, resolvedAt: "2027-01-01T00:00:00Z" },
  ];
  const insufficient = estimateComparableSetupProbability({
    outcomes, bucket: "A", cutoff: "2026-06-01T00:00:00Z", minimumSamples: 2,
  });
  assert.equal(insufficient.probability, null);
  assert.deepEqual(insufficient.missingReasons, ["INSUFFICIENT_COMPARABLE_SAMPLES"]);

  const invalidCalibration = estimateComparableSetupProbability({
    outcomes: [...outcomes, { bucket: "A", success: false, resolvedAt: "2026-01-02T00:00:00Z" }],
    bucket: "A",
    cutoff: "2026-06-01T00:00:00Z",
    minimumSamples: 2,
    calibration: { points: [{ predicted: 0, observed: 0 }, { predicted: 1, observed: 1 }] },
  });
  assert.equal(invalidCalibration.probability, null);
  assert.deepEqual(invalidCalibration.missingReasons, ["CALIBRATION_NOT_OUT_OF_SAMPLE"]);
});

test("expected value subtracts all costs and preserves null evidence", () => {
  const result = calculateForexExpectedValue({
    probability: 0.6,
    reward: 200,
    loss: 100,
    spreadCost: 4,
    slippageCost: 3,
    financingCost: 2,
  });
  assert.equal(result.grossExpectedValue, 80);
  assert.equal(result.expectedValue, 71);
  assert.equal(result.units, "ACCOUNT_CURRENCY_PER_TRADE");

  const missing = calculateForexExpectedValue({
    probability: 0.6, reward: 200, loss: 100, spreadCost: 4, slippageCost: 3,
  });
  assert.equal(missing.expectedValue, null);
  assert.ok(missing.missingReasons.includes("FINANCING_COST_MISSING_OR_INVALID"));
});

test("canonical action requires every gate and never uses score as approval", () => {
  const common = {
    side: "BUY",
    dataFresh: true,
    calendarClear: true,
    liquidityAdequate: true,
    spreadAcceptable: true,
    expectedValue: 2,
    riskApproved: true,
    strategyApproved: true,
    score: 1,
  };
  assert.equal(decideForexAction(common).action, "BUY");

  const missing = decideForexAction({ ...common, calendarClear: undefined, score: 100 });
  assert.equal(missing.action, "WAIT");
  assert.equal(missing.disposition, "WAIT");
  assert.equal(missing.reason, "CALENDAR_EVIDENCE_MISSING");

  const rejected = decideForexAction({ ...common, spreadAcceptable: false });
  assert.equal(rejected.action, "WAIT");
  assert.equal(rejected.disposition, "REJECT");
  assert.equal(rejected.reason, "SPREAD_REJECTED");
});

test("pair return correlation uses aligned finite observations", () => {
  const result = pairReturnCorrelation([1, 2, 3, 4], [4, 3, 2, 1]);
  assert.equal(result.correlation, -1);
  assert.equal(result.sampleSize, 4);
  assert.equal(pairReturnCorrelation([1], [1]).correlation, null);
});

test("currency-leg exposure reports net and gross native and account values", () => {
  const exposure = calculateCurrencyLegExposure({
    positions: [
      { id: "one", pair: "EUR_USD", side: "BUY", units: 100, price: 1.1 },
      { id: "two", pair: "EUR_USD", side: "SELL", units: 40, price: 1.2 },
    ],
    accountCurrency: "USD",
    conversionRates: { EUR: 1.15 },
  });
  assert.equal(exposure.currencies.EUR.netNative, 60);
  assert.equal(exposure.currencies.EUR.grossNative, 140);
  assert.ok(Math.abs(exposure.currencies.USD.netNative - (-62)) < 1e-12);
  assert.ok(Math.abs(exposure.currencies.USD.grossNative - 158) < 1e-12);
  assert.equal(exposure.currencies.EUR.netAccount, 69);
  assert.equal(exposure.conversionComplete, true);
});

test("portfolio risk combines open and pending risk and applies drawdown controls", () => {
  const progressive = progressiveDrawdownMultiplier({
    drawdownFraction: 0.06, reductionStartsAt: 0.02, hardStopAt: 0.1, minimumMultiplier: 0.2,
  });
  assert.ok(Math.abs(progressive.multiplier - 0.6) < 1e-12);
  assert.equal(progressive.hardStop, false);

  const accepted = assessPortfolioRisk({
    openRisk: 20,
    pendingRisk: 10,
    proposedRisk: 5,
    accountRiskCap: 40,
    strategyId: "trend",
    strategyRisk: { trend: 10 },
    strategyCaps: { trend: 20 },
    weeklyLossFraction: 0.01,
    weeklyLossLimit: 0.05,
    currencySameDirectionRisk: 5,
    currencyRiskCap: 20,
    openPositionCount: 0,
    drawdownFraction: 0.06,
    drawdownPolicy: { reductionStartsAt: 0.02, hardStopAt: 0.1, minimumMultiplier: 0.2 },
  });
  assert.equal(accepted.openPlusPendingRisk, 30);
  assert.equal(accepted.approved, true);
  assert.equal(accepted.resultingCurrencyRisk, 10);
  assert.ok(Math.abs(accepted.adjustedProposedRisk - 3) < 1e-12);

  const stopped = assessPortfolioRisk({
    openRisk: 20,
    pendingRisk: 10,
    proposedRisk: 5,
    accountRiskCap: 30,
    strategyId: "trend",
    strategyRisk: { trend: 19 },
    strategyCaps: { trend: 20 },
    weeklyLossFraction: 0.05,
    weeklyLossLimit: 0.05,
    currencySameDirectionRisk: 20,
    currencyRiskCap: 20,
    openPositionCount: 0,
    drawdownFraction: 0.1,
  });
  assert.equal(stopped.approved, false);
  assert.ok(stopped.rejectionReasons.includes("ACCOUNT_RISK_CAP_EXCEEDED"));
  assert.ok(stopped.rejectionReasons.includes("STRATEGY_RISK_CAP_EXCEEDED"));
  assert.ok(stopped.rejectionReasons.includes("WEEKLY_LOSS_LIMIT_REACHED"));
  assert.ok(stopped.rejectionReasons.includes("DRAWDOWN_HARD_STOP"));
});

test("portfolio authority fails closed on missing correlation and caps correlated currency risk", () => {
  const common = {
    openRisk: 5, pendingRisk: 0, proposedRisk: 5, accountRiskCap: 30,
    strategyId: "trend", strategyRisk: 5, strategyRiskCap: 20,
    weeklyLossFraction: 0, weeklyLossLimit: 0.04, drawdownFraction: 0,
    currencySameDirectionRisk: 5, currencyRiskCap: 20,
    openPositionCount: 1, correlationRiskCap: 8,
  };
  const missing = assessPortfolioRisk(common);
  assert.equal(missing.approved, false);
  assert.ok(missing.missingReasons.includes("PAIR_CORRELATION_EVIDENCE_MISSING"));

  const correlated = assessPortfolioRisk({
    ...common,
    correlationEvidence: [{ pair: "GBP_USD", correlation: 0.92, sameDirection: true, risk: 5 }],
  });
  assert.equal(correlated.approved, false);
  assert.ok(correlated.rejectionReasons.includes("PAIR_CORRELATION_CAP_EXCEEDED"));
});
