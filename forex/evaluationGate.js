export const EVALUATION_MINIMUMS = Object.freeze({
  minCompletedTrades: 200,
  minMonths: 12,
  requireForwardPractice: true,
  requireLowerBoundAboveZero: true,
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
