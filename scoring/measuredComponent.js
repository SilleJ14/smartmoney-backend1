// Unavailable evidence is null. A measured 0 stays 0. F is the quality of the
// evidence that was actually read, weighted by how much of each component
// was measured. Coverage and the evidence basis explain the number.

export const SCORE_CHANGE_CAUSES = Object.freeze([
  "MARKET_EVIDENCE_CHANGED",
  "NEW_EVIDENCE_ADDED",
  "EVIDENCE_LOST",
  "EVIDENCE_RECOVERED",
  "MODEL_RECALCULATION",
]);

export const COMPONENT_PUBLISH_MINIMUM = Object.freeze({
  discovery: 0.5,
  entry: 0.5,
  marketContext: 0.5,
  riskPortfolio: 0.6,
  fundamentals: 0.5,
  base: 0.5,
  execution: 0.5,
  runner: 0.5,
  strategyEvolution: 0.5,
});

export const STOCK_DECISION_EVIDENCE_POLICY = Object.freeze({
  discovery: "REQUIRED",
  entry: "REQUIRED",
  marketContext: "OPTIONAL",
  riskPortfolio: "REQUIRED",
  fundamentals: "REQUIRED",
  news: "REQUIRED_WHEN_CATALYST",
  executionQuote: "REQUIRED",
});

export const CRYPTO_DECISION_EVIDENCE_POLICY = Object.freeze({
  base: "REQUIRED",
  execution: "REQUIRED",
  runner: "OPTIONAL",
  strategyEvolution: "OPTIONAL",
});

const UNKNOWN_REASONS = Object.freeze({
  discovery: "DISCOVERY_UNKNOWN",
  entry: "ENTRY_UNKNOWN",
  marketContext: "MARKET_CONTEXT_UNKNOWN",
  riskPortfolio: "RISK_UNKNOWN",
  fundamentals: "FUNDAMENTALS_UNKNOWN",
  base: "DISCOVERY_UNKNOWN",
  execution: "EXECUTION_UNKNOWN",
  runner: "CONTINUATION_UNKNOWN",
  strategyEvolution: "CONTEXT_UNKNOWN",
  news: "NEWS_UNKNOWN",
  executionQuote: "BOOK_UNAVAILABLE",
});

function round(value, places = 2) {
  const score = Number(value);
  if (!Number.isFinite(score)) return null;
  const factor = 10 ** places;
  return Math.round(score * factor) / factor;
}

function clampScore(value) {
  return Math.max(0, Math.min(100, Number(value)));
}

function clampUnit(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(1, number));
}

export const ANALYTICAL_ACTIONS = Object.freeze([
  "SWITCH_SETUP_MODEL",
  "ABANDON_CURRENT_MODEL",
  "RESCORE",
  "COLLECT_EVIDENCE",
  "EVIDENCE_SUFFICIENT",
]);

export const MEASURED_EVIDENCE_STALE_REASONS = Object.freeze([
  "PRICE_DRIFT",
  "NEW_BARS",
  "SETUP_TRANSITION",
  "NEW_CATALYST",
  "MARKET_REGIME_CHANGE",
]);

export function buildMeasuredComponent({
  componentName,
  score = null,
  coverage = 0,
  configuredWeight = 0,
  minimumCoverage = 0.5,
  unreadCeiling = 100,
  unreadFloor = 0,
  missingInputs = [],
  measuredInputs = [],
  source = null,
  updatedAt = null,
} = {}) {
  const fraction = Math.max(0, Math.min(1, Number(coverage) || 0));
  const numeric = score === null || score === undefined || score === "" ? null : Number(score);
  const finiteScore = Number.isFinite(numeric) ? clampScore(numeric) : null;
  const publishable = finiteScore !== null && fraction > 0 && fraction + 1e-9 >= Number(minimumCoverage);
  const measuredWeight = publishable ? Number(configuredWeight || 0) * fraction : 0;
  const state = !publishable ? "UNKNOWN" : fraction >= 0.999 ? "PRESENT" : "PARTIAL";
  const ceiling = Number.isFinite(Number(unreadCeiling)) ? clampScore(unreadCeiling) : 100;
  const floor = Math.min(ceiling, Number.isFinite(Number(unreadFloor)) ? clampScore(unreadFloor) : 0);
  return {
    componentName,
    componentScore: publishable ? finiteScore : null,
    componentCoverage: round(fraction, 4) ?? 0,
    componentPublishable: publishable,
    configuredWeight: Number(configuredWeight || 0),
    measuredWeight: round(measuredWeight, 6) ?? 0,
    sliceScore: finiteScore,
    sliceCoverage: finiteScore === null ? 0 : fraction,
    unreadCeiling: ceiling,
    unreadFloor: floor,
    missingInputs: [...missingInputs],
    measuredInputs: [...measuredInputs],
    state,
    updatedAt,
    source,
  };
}

function sliceBounds(component = {}) {
  const weight = Number(component.configuredWeight || 0);
  const ceiling = Number.isFinite(Number(component.unreadCeiling)) ? clampScore(component.unreadCeiling) : 100;
  const floor = Math.min(ceiling, Number.isFinite(Number(component.unreadFloor)) ? clampScore(component.unreadFloor) : 0);
  const raw = component.sliceScore !== undefined && component.sliceScore !== null
    ? component.sliceScore
    : component.componentPublishable ? component.componentScore : null;
  const observed = raw === null || raw === undefined || !Number.isFinite(Number(raw)) ? null : clampScore(raw);
  const coverage = observed === null ? 0 : clampUnit(component.sliceCoverage ?? component.componentCoverage ?? 0);
  const measuredWeight = observed === null ? 0 : weight * coverage;
  const unreadWeight = Math.max(0, weight - measuredWeight);
  return {
    weight,
    measuredWeight,
    unreadWeight,
    observed,
    ceiling,
    floor,
    maxContribution: (observed === null ? 0 : observed * measuredWeight) + ceiling * unreadWeight,
    minContribution: (observed === null ? 0 : observed * measuredWeight) + floor * unreadWeight,
  };
}

export function evidenceBasisVersion(basis = {}) {
  const text = Object.keys(basis).sort().map((key) => `${key}:${basis[key]}`).join("|");
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function aggregateMeasuredComponents(components = []) {
  const list = Array.isArray(components) ? components : [];
  const configured = list.reduce((sum, component) => sum + Number(component.configuredWeight || 0), 0);
  const measured = list.reduce((sum, component) => sum + Number(component.measuredWeight || 0), 0);
  const numerator = list.reduce(
    (sum, component) => sum + (component.componentPublishable ? component.componentScore * component.measuredWeight : 0),
    0
  );
  const slices = list.map(sliceBounds);
  const maxNumerator = slices.reduce((sum, slice) => sum + slice.maxContribution, 0);
  const minNumerator = slices.reduce((sum, slice) => sum + slice.minContribution, 0);
  const evidenceBasis = {};
  for (const component of list) evidenceBasis[component.componentName] = component.state;
  const withContribution = list.map((component) => ({
    ...component,
    contribution: component.componentPublishable && measured > 0
      ? round(component.componentScore * component.measuredWeight / measured)
      : 0,
  }));
  return {
    score: measured > 0 ? round(numerator / measured) : null,
    coverage: configured > 0 ? round(measured / configured, 4) ?? 0 : 0,
    maximumPossibleF: configured > 0 ? round(maxNumerator / configured) : null,
    minimumPossibleF: configured > 0 ? round(minNumerator / configured) : null,
    evidenceBasis,
    evidenceBasisVersion: evidenceBasisVersion(evidenceBasis),
    measuredWeight: round(measured, 6) ?? 0,
    configuredWeight: round(configured, 6) ?? 0,
    components: withContribution,
  };
}

function presentState(state) {
  return state === "PRESENT" || state === "PARTIAL";
}

export function classifyScoreChange({
  previousBasis = null,
  nextBasis = null,
  previousScore = null,
  nextScore = null,
  previousCoverage = null,
  nextCoverage = null,
} = {}) {
  if (!previousBasis) return nextScore === null ? "MODEL_RECALCULATION" : "NEW_EVIDENCE_ADDED";
  const keys = new Set([...Object.keys(previousBasis), ...Object.keys(nextBasis || {})]);
  let lost = false;
  let recovered = false;
  for (const key of keys) {
    const before = presentState(previousBasis[key]);
    const after = presentState(nextBasis?.[key]);
    if (before && !after) lost = true;
    if (!before && after) recovered = true;
  }
  const rose = Number(nextScore) > Number(previousScore);
  const coverageFell = Number(nextCoverage) < Number(previousCoverage);
  if (lost && rose && coverageFell && !recovered) return "EVIDENCE_LOST";
  if (recovered && !lost) return "EVIDENCE_RECOVERED";
  if (lost || recovered) return "MARKET_EVIDENCE_CHANGED";
  if (Number(nextScore) !== Number(previousScore)) return "MARKET_EVIDENCE_CHANGED";
  return "MODEL_RECALCULATION";
}

export function evaluateEvidencePolicy(basis = {}, policy = {}, { newsUnknown = false } = {}) {
  const reasons = [];
  for (const [name, requirement] of Object.entries(policy)) {
    if (requirement === "REQUIRED" && basis[name] === "UNKNOWN") {
      reasons.push(UNKNOWN_REASONS[name] || `${name.toUpperCase()}_UNKNOWN`);
    }
    if (requirement === "REQUIRED_WHEN_CATALYST" && newsUnknown) {
      reasons.push(UNKNOWN_REASONS[name] || "NEWS_UNKNOWN");
    }
  }
  return { state: reasons.length ? "DATA_UNAVAILABLE" : "PASS", reasons };
}

function boundaryDistance(minimum, maximum, required) {
  if (minimum !== null && minimum + 1e-9 >= required) return round(minimum - required);
  if (maximum !== null && maximum + 1e-9 < required) return round(maximum - required);
  return 0;
}

function modelCanPass(model = {}, requiredFinalScore, requiredEntryScore) {
  const maximumF = Number(model.maximumPossibleScore ?? model.maximumPossibleF);
  const requiredF = Number(model.requiredFinalScore ?? requiredFinalScore);
  const requiredE = model.requiredEntryScore === undefined ? requiredEntryScore : model.requiredEntryScore;
  const maximumE = Number(model.maximumPossibleEntryScore);
  const finalReachable = Number.isFinite(maximumF) && maximumF + 1e-9 >= requiredF;
  const entryReachable = requiredE === null || requiredE === undefined
    || (Number.isFinite(maximumE) && maximumE + 1e-9 >= Number(requiredE));
  return finalReachable && entryReachable;
}

function collectReason(missing = []) {
  if (missing.includes("FUNDAMENTALS_UNKNOWN") || missing.includes("fundamentals")) return "FUNDAMENTALS_REQUIRED_BY_C";
  return missing[0] || "UNREAD_EVIDENCE_CAN_CHANGE_DECISION";
}

export function entryScoreBound({
  score = null,
  coverage = 0,
  unreadCeiling = 100,
  unreadFloor = 0,
} = {}) {
  const slice = sliceBounds({
    configuredWeight: 1,
    sliceScore: score,
    sliceCoverage: score === null || score === undefined ? 0 : coverage,
    unreadCeiling,
    unreadFloor,
  });
  return {
    currentEntryScore: slice.observed,
    maximumPossibleEntryScore: round(slice.maxContribution),
    minimumPossibleEntryScore: round(slice.minContribution),
  };
}

export function computeAnalyticalBounds({
  components = [],
  requiredFinalScore = 70,
  entry = null,
  mandatoryEvidenceMissing = [],
  evidenceStale = false,
  staleReason = null,
  alternateModels = [],
} = {}) {
  const aggregated = aggregateMeasuredComponents(components);
  const currentScore = aggregated.score;
  const maximumPossibleScore = aggregated.maximumPossibleF;
  const minimumPossibleScore = aggregated.minimumPossibleF;
  const remainingScoreDelta = currentScore === null || maximumPossibleScore === null
    ? null
    : round(maximumPossibleScore - currentScore);
  const entryBound = entry
    ? entryScoreBound(entry)
    : { currentEntryScore: null, maximumPossibleEntryScore: null, minimumPossibleEntryScore: null };
  const requiredEntryScore = entry && Number.isFinite(Number(entry.required)) ? Number(entry.required) : null;
  const finalScoreReachable = maximumPossibleScore !== null && maximumPossibleScore + 1e-9 >= requiredFinalScore;
  const finalScoreGuaranteed = minimumPossibleScore !== null && minimumPossibleScore + 1e-9 >= requiredFinalScore;
  const entryScoreReachable = requiredEntryScore === null
    || (entryBound.maximumPossibleEntryScore !== null && entryBound.maximumPossibleEntryScore + 1e-9 >= requiredEntryScore);
  const entryScoreGuaranteed = requiredEntryScore === null
    || (entryBound.minimumPossibleEntryScore !== null && entryBound.minimumPossibleEntryScore + 1e-9 >= requiredEntryScore);
  const missingMandatory = Array.isArray(mandatoryEvidenceMissing) ? mandatoryEvidenceMissing.filter(Boolean) : [];
  const analyticalPassReachable = finalScoreReachable && entryScoreReachable;
  const analyticalPassGuaranteed = finalScoreGuaranteed && entryScoreGuaranteed && missingMandatory.length === 0;
  const eligibleAlternate = (Array.isArray(alternateModels) ? alternateModels : [])
    .find((model) => model && model.eligible === true && modelCanPass(model, requiredFinalScore, requiredEntryScore));
  let recommendedAction = "EVIDENCE_SUFFICIENT";
  let actionReason = "ANALYTICAL_GATES_GUARANTEED";
  if (!analyticalPassReachable && eligibleAlternate) {
    recommendedAction = "SWITCH_SETUP_MODEL";
    actionReason = "ALTERNATE_SETUP_REACHABLE";
  } else if (!analyticalPassReachable) {
    recommendedAction = "ABANDON_CURRENT_MODEL";
    actionReason = finalScoreReachable ? "ENTRY_SCORE_UNREACHABLE" : "FINAL_SCORE_UNREACHABLE";
  } else if (evidenceStale === true || MEASURED_EVIDENCE_STALE_REASONS.includes(staleReason)) {
    recommendedAction = "RESCORE";
    actionReason = staleReason || "MEASURED_EVIDENCE_STALE";
  } else if (!analyticalPassGuaranteed) {
    recommendedAction = "COLLECT_EVIDENCE";
    actionReason = collectReason(missingMandatory);
  }
  return {
    currentScore,
    minimumPossibleScore,
    maximumPossibleScore,
    remainingScoreDelta,
    remainingUpside: remainingScoreDelta === null ? null : round(Math.max(0, remainingScoreDelta)),
    configuredWeight: aggregated.configuredWeight,
    measuredWeight: aggregated.measuredWeight,
    requiredFinalScore,
    currentEntryScore: entryBound.currentEntryScore,
    minimumPossibleEntryScore: entryBound.minimumPossibleEntryScore,
    maximumPossibleEntryScore: entryBound.maximumPossibleEntryScore,
    requiredEntryScore,
    finalScoreReachable,
    entryScoreReachable,
    analyticalPassReachable,
    finalScoreGuaranteed,
    entryScoreGuaranteed,
    analyticalPassGuaranteed,
    decisionBoundaryDistance: boundaryDistance(minimumPossibleScore, maximumPossibleScore, requiredFinalScore),
    recommendedAction,
    actionReason,
    alternateModel: recommendedAction === "SWITCH_SETUP_MODEL" ? (eligibleAlternate.name || eligibleAlternate.setupState || null) : null,
    evidenceBasis: aggregated.evidenceBasis,
    evidenceBasisVersion: aggregated.evidenceBasisVersion,
  };
}
