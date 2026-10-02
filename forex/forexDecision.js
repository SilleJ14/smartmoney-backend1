const finite = value => typeof value === "number" && Number.isFinite(value);

function missingResult(reason, extra = {}) {
  return { value: null, missingReasons: [reason], ...extra };
}

/**
 * Produces a transparent ranking score. Missing components reduce coverage but
 * do not become zeroes. The score is deliberately not a probability.
 */
export function scoreForexOpportunity(components = {}) {
  const entries = Array.isArray(components)
    ? components.map((component, index) => [component.name || `component_${index + 1}`, component])
    : Object.entries(components || {});
  const details = {};
  const missingReasons = [];
  let availableWeight = 0;
  let totalWeight = 0;
  let weightedScore = 0;

  for (const [name, input] of entries) {
    const component = finite(input) ? { value: input } : (input || {});
    const weight = finite(component.weight) && component.weight > 0 ? component.weight : 1;
    totalWeight += weight;
    const value = component.value;
    if (!finite(value) || value < 0 || value > 100 || component.available === false) {
      const reason = component.missingReason || `${name.toUpperCase()}_UNAVAILABLE`;
      details[name] = { value: null, weight, available: false, missingReason: reason };
      missingReasons.push(reason);
      continue;
    }
    details[name] = { value, weight, available: true, contribution: value * weight };
    availableWeight += weight;
    weightedScore += value * weight;
  }

  return {
    score: availableWeight ? weightedScore / availableWeight : null,
    coverage: totalWeight ? availableWeight / totalWeight : 0,
    availableWeight,
    totalWeight,
    components: details,
    missingReasons,
    meaning: "RANKING_ONLY_NOT_PROBABILITY",
  };
}

export const opportunityScore = scoreForexOpportunity;
export const computeOpportunityScore = scoreForexOpportunity;

function outcomeBucket(row) {
  return row?.bucket ?? row?.setupBucket ?? row?.comparableSetup;
}

function outcomeTime(row) {
  const value = row?.resolvedAt ?? row?.outcomeAt ?? row?.timestamp ?? row?.time;
  const time = typeof value === "number" ? value : Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

function outcomeSuccess(row) {
  if (row?.success === true || row?.win === true || row?.outcome === "WIN") return 1;
  if (row?.success === false || row?.win === false || row?.outcome === "LOSS") return 0;
  return null;
}

function interpolateCalibration(probability, mapping) {
  const points = Array.isArray(mapping) ? mapping : mapping?.points;
  if (!Array.isArray(points) || points.length === 0) return null;
  const sorted = points
    .map(point => ({
      predicted: Number(point.predicted ?? point.input ?? point.x),
      observed: Number(point.observed ?? point.output ?? point.y),
    }))
    .filter(point => finite(point.predicted) && finite(point.observed))
    .sort((a, b) => a.predicted - b.predicted);
  if (!sorted.length) return null;
  if (probability <= sorted[0].predicted) return sorted[0].observed;
  if (probability >= sorted.at(-1).predicted) return sorted.at(-1).observed;
  const upperIndex = sorted.findIndex(point => point.predicted >= probability);
  const lower = sorted[upperIndex - 1];
  const upper = sorted[upperIndex];
  const ratio = (probability - lower.predicted) / (upper.predicted - lower.predicted);
  return lower.observed + ratio * (upper.observed - lower.observed);
}

/**
 * Estimates empirical P(win | comparable setup). Only outcomes resolved before
 * cutoff are eligible. Calibration is applied only when explicitly identified
 * as out-of-sample; it is never derived from an opportunity score.
 */
export function estimateComparableSetupProbability({
  outcomes = [],
  bucket,
  cutoff,
  asOf,
  minimumSamples = 20,
  minSamples,
  priorAlpha = 1,
  priorBeta = 1,
  calibration,
  calibrationMapping,
} = {}) {
  const cutoffMs = outcomeTime({ timestamp: cutoff ?? asOf });
  if (!bucket) return missingResult("COMPARABLE_SETUP_BUCKET_MISSING", { probability: null });
  if (!finite(cutoffMs)) return missingResult("TIME_CUTOFF_MISSING", { probability: null });
  if (!(priorAlpha > 0) || !(priorBeta > 0)) {
    return missingResult("INVALID_BETA_PRIOR", { probability: null });
  }

  const eligible = outcomes.filter(row =>
    outcomeBucket(row) === bucket &&
    outcomeTime(row) !== null &&
    outcomeTime(row) < cutoffMs &&
    outcomeSuccess(row) !== null
  );
  const required = minSamples ?? minimumSamples;
  if (eligible.length < required) {
    return missingResult("INSUFFICIENT_COMPARABLE_SAMPLES", {
      probability: null, sampleSize: eligible.length, minimumSamples: required, bucket,
    });
  }

  const wins = eligible.reduce((sum, row) => sum + outcomeSuccess(row), 0);
  const losses = eligible.length - wins;
  const posteriorAlpha = priorAlpha + wins;
  const posteriorBeta = priorBeta + losses;
  const empiricalProbability = posteriorAlpha / (posteriorAlpha + posteriorBeta);
  const suppliedCalibration = calibrationMapping ?? calibration;
  let probability = empiricalProbability;
  let calibrationApplied = false;
  const missingReasons = [];
  if (suppliedCalibration) {
    if (suppliedCalibration.outOfSample !== true && suppliedCalibration.source !== "OOS") {
      return missingResult("CALIBRATION_NOT_OUT_OF_SAMPLE", {
        probability: null, empiricalProbability, sampleSize: eligible.length, bucket,
      });
    }
    const calibrated = interpolateCalibration(empiricalProbability, suppliedCalibration);
    if (!finite(calibrated) || calibrated < 0 || calibrated > 1) {
      return missingResult("INVALID_CALIBRATION_MAPPING", {
        probability: null, empiricalProbability, sampleSize: eligible.length, bucket,
      });
    }
    probability = calibrated;
    calibrationApplied = true;
  } else {
    missingReasons.push("OOS_CALIBRATION_NOT_SUPPLIED");
  }

  return {
    value: probability,
    probability,
    empiricalProbability,
    sampleSize: eligible.length,
    wins,
    losses,
    posteriorAlpha,
    posteriorBeta,
    bucket,
    cutoff: new Date(cutoffMs).toISOString(),
    calibrationApplied,
    missingReasons,
    source: "BUCKETED_HISTORICAL_OUTCOMES_BETA_BINOMIAL",
  };
}

export const comparableSetupProbability = estimateComparableSetupProbability;
export const estimateWinProbability = estimateComparableSetupProbability;

/**
 * All monetary inputs must use the same stated unit, normally account currency
 * per trade (or per unit when quantity is one).
 */
export function calculateForexExpectedValue({
  probability,
  winProbability,
  reward,
  grossReward,
  loss,
  grossLoss,
  spreadCost,
  slippageCost,
  financingCost,
  units = "ACCOUNT_CURRENCY_PER_TRADE",
} = {}) {
  const p = probability ?? winProbability;
  const gain = reward ?? grossReward;
  const downside = loss ?? grossLoss;
  const costs = { spreadCost, slippageCost, financingCost };
  const missingReasons = [];
  if (!finite(p) || p < 0 || p > 1) missingReasons.push("PROBABILITY_MISSING_OR_INVALID");
  if (!finite(gain) || gain < 0) missingReasons.push("REWARD_MISSING_OR_INVALID");
  if (!finite(downside) || downside < 0) missingReasons.push("LOSS_MISSING_OR_INVALID");
  for (const [name, value] of Object.entries(costs)) {
    const label = name.replace(/([a-z])([A-Z])/g, "$1_$2").toUpperCase();
    if (!finite(value) || value < 0) missingReasons.push(`${label}_MISSING_OR_INVALID`);
  }
  if (missingReasons.length) {
    return { value: null, expectedValue: null, units, missingReasons };
  }
  const grossExpectedValue = p * gain - (1 - p) * downside;
  const totalCosts = spreadCost + slippageCost + financingCost;
  const expectedValue = grossExpectedValue - totalCosts;
  return {
    value: expectedValue,
    expectedValue,
    grossExpectedValue,
    totalCosts,
    units,
    formula: "p*reward - (1-p)*loss - spreadCost - slippageCost - financingCost",
    missingReasons: [],
  };
}

export const expectedValue = calculateForexExpectedValue;
export const calculateExpectedValue = calculateForexExpectedValue;

const GATES = [
  ["dataFresh", "DATA_FRESHNESS"],
  ["calendarClear", "CALENDAR"],
  ["liquidityAdequate", "LIQUIDITY"],
  ["spreadAcceptable", "SPREAD"],
  ["evPositive", "EXPECTED_VALUE"],
  ["riskApproved", "RISK"],
  ["strategyApproved", "STRATEGY"],
];

/**
 * BUY/SELL are possible only with affirmative evidence at every mandatory gate.
 * Score is intentionally absent: it ranks candidates and cannot authorize one.
 */
export function decideForexAction(input = {}) {
  const side = String(input.side || "").toUpperCase();
  const evidence = { ...input };
  if (evidence.evPositive === undefined && finite(input.expectedValue)) {
    evidence.evPositive = input.expectedValue > 0;
  }
  const missingReasons = [];
  const rejectionReasons = [];
  const gates = {};
  for (const [field, label] of GATES) {
    const value = evidence[field];
    gates[field] = value === true ? "PASS" : value === false ? "FAIL" : "MISSING";
    if (value === false) rejectionReasons.push(`${label}_REJECTED`);
    else if (value !== true) missingReasons.push(`${label}_EVIDENCE_MISSING`);
  }
  if (side !== "BUY" && side !== "SELL") missingReasons.push("SIDE_EVIDENCE_MISSING");

  const approved = !missingReasons.length && !rejectionReasons.length;
  return {
    action: approved ? side : "WAIT",
    disposition: approved ? "APPROVE" : rejectionReasons.length ? "REJECT" : "WAIT",
    reason: rejectionReasons[0] || missingReasons[0] || "ALL_MANDATORY_GATES_PASSED",
    rejectionReasons,
    missingReasons,
    gates,
  };
}

export const canonicalForexDecision = decideForexAction;
export const evaluateForexDecision = decideForexAction;
