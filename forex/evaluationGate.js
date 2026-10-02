export const EVALUATION_MINIMUMS = Object.freeze({
  minCompletedTrades: 200,
  minMonths: 12,
  requireForwardPractice: true,
  requireLowerBoundAboveZero: true,
  maxProbabilityBacktestOverfit: 0.2,
  minDeflatedSharpeProbability: 0.95,
  maxBrierScore: 0.25,
});

export function evaluateStrategyReport(report = {}) {
  const reasons = [];
  if (Number(report.completedTrades || 0) < EVALUATION_MINIMUMS.minCompletedTrades) {
    reasons.push("INSUFFICIENT_SAMPLE");
  }
  if (Number(report.months || 0) < EVALUATION_MINIMUMS.minMonths) {
    reasons.push("INSUFFICIENT_PERIOD");
  }
  if (EVALUATION_MINIMUMS.requireForwardPractice && report.forwardPractice !== true) {
    reasons.push("FORWARD_PRACTICE_REQUIRED");
  }
  if (EVALUATION_MINIMUMS.requireLowerBoundAboveZero && !(Number(report.expectancyLowerBound) > 0)) {
    reasons.push("EXPECTANCY_LOWER_BOUND");
  }
  if (report.drawdownAcceptable !== true) reasons.push("DRAWDOWN_POLICY");
  if (report.survivedAdverseCosts !== true) reasons.push("ADVERSE_COSTS");
  if (report.independentOfOtherStrategy !== true) reasons.push("NOT_INDEPENDENT");
  if (report.walkForwardPassed !== true) reasons.push("WALK_FORWARD_REQUIRED");
  if (report.untouchedOutOfSamplePassed !== true) reasons.push("OUT_OF_SAMPLE_REQUIRED");
  if (!(Number(report.probabilityBacktestOverfit) >= 0) ||
      Number(report.probabilityBacktestOverfit) > EVALUATION_MINIMUMS.maxProbabilityBacktestOverfit) {
    reasons.push("BACKTEST_OVERFIT_RISK");
  }
  if (!(Number(report.deflatedSharpeProbability) >= EVALUATION_MINIMUMS.minDeflatedSharpeProbability)) {
    reasons.push("DEFLATED_SHARPE");
  }
  if (!(Number(report.brierScore) >= 0) ||
      Number(report.brierScore) > EVALUATION_MINIMUMS.maxBrierScore ||
      report.calibrationPassed !== true) {
    reasons.push("PROBABILITY_CALIBRATION");
  }
  if (report.featureSnapshotVersion == null || report.configHash == null) {
    reasons.push("REPRODUCIBILITY_EVIDENCE");
  }
  return { ok: reasons.length === 0, reasons };
}

export function permittedEnvironmentForReport(report) {
  const result = evaluateStrategyReport(report);
  if (!result.ok) return "RESEARCH";
  if (report.environmentRequested === "LIVE" && report.limitedLivePassed === true) return "LIVE";
  if (report.environmentRequested === "LIMITED_LIVE") return "LIMITED_LIVE";
  if (report.forwardPractice === true) return "FORWARD_PRACTICE";
  return "HISTORICAL_VALIDATION";
}
