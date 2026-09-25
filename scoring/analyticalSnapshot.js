// Two frozen records. The analytical revision is what SmartMoney believes now.
// The authorized snapshot is what it is allowed to trade from. Neither is edited in place.

export const STOCK_FORMULA_VERSION = "stock-final-v4";
export const STOCK_WEIGHTS_VERSION = "2026-09-25";

function freeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freeze(child);
  return Object.freeze(value);
}

function clone(value) {
  return value == null ? value : structuredClone(value);
}

export function selectDiscoveryInput({
  measuredContinuationEligible = false,
  continuationScore = null,
  earlyBuyScore = null,
  earlyScore = null,
} = {}) {
  if (measuredContinuationEligible && Number.isFinite(Number(continuationScore))) {
    return {
      score: Number(continuationScore),
      source: "CONTINUATION_SETUP",
      state: "PASS",
    };
  }
  const earlyCandidate = earlyBuyScore === null || earlyBuyScore === undefined || earlyBuyScore === ""
    ? earlyScore
    : earlyBuyScore;
  const early = earlyCandidate === null || earlyCandidate === undefined || earlyCandidate === ""
    ? null
    : Number(earlyCandidate);
  if (!Number.isFinite(early)) {
    return { score: null, source: "EARLY_DISCOVERY", state: "DATA_UNAVAILABLE" };
  }
  return { score: early, source: "EARLY_DISCOVERY", state: "PASS" };
}

export function displayedComponent(snapshot, name) {
  const component = snapshot?.components?.[name];
  if (!component || component.state === "DATA_UNAVAILABLE" || !Number.isFinite(Number(component.score))) {
    return { score: null, state: "DATA_UNAVAILABLE", text: "—" };
  }
  return { score: Number(component.score), state: component.state || "PASS", text: String(component.score) };
}

export function reproduceFinalScore(snapshot = {}) {
  const components = snapshot.components || snapshot.authorizedComponents || {};
  const weights = snapshot.weights || snapshot.authorizedWeights || {};
  let numerator = 0;
  let measured = 0;
  for (const [name, component] of Object.entries(components)) {
    const weight = Number(weights[name] ?? component.configuredWeight);
    const coverage = Number(component.coverage);
    const score = Number(component.score);
    if (!Number.isFinite(score) || !Number.isFinite(weight) || !(coverage > 0)) continue;
    const measuredWeight = Number.isFinite(Number(component.measuredWeight))
      ? Number(component.measuredWeight)
      : weight * coverage;
    numerator += score * measuredWeight;
    measured += measuredWeight;
  }
  if (!(measured > 0)) return null;
  return Math.round((numerator / measured) * 100) / 100;
}

export function buildCurrentAnalyticalSnapshot({
  previous = null,
  now = new Date().toISOString(),
  components,
  weights,
  F,
  coverage = null,
  configuredWeight = null,
  measuredWeight = null,
  minimumPossibleScore = null,
  maximumPossibleScore = null,
  setupState = null,
  setupModel = null,
  diagnostics = {},
  marketData = null,
} = {}) {
  const draftKey = JSON.stringify({ components, weights, F, setupState, setupModel, marketData });
  const unchanged = previous && previous.draftKey === draftKey;
  const snapshot = freeze({
    kind: "CURRENT_ANALYTICAL",
    analyticalRevision: unchanged ? previous.analyticalRevision : (Number(previous?.analyticalRevision) || 0) + 1,
    analyticalUpdatedAt: unchanged ? previous.analyticalUpdatedAt : now,
    formulaVersion: STOCK_FORMULA_VERSION,
    weightsVersion: STOCK_WEIGHTS_VERSION,
    setupState,
    setupModel,
    components: clone(components),
    weights: clone(weights),
    F,
    coverage,
    configuredWeight,
    measuredWeight,
    currentScore: F,
    minimumPossibleScore,
    maximumPossibleScore,
    diagnostics: clone(diagnostics),
    marketData: clone(marketData),
    draftKey,
  });
  return snapshot;
}

export function appendAnalyticalRevision(history = [], snapshot) {
  const previous = history.at(-1);
  if (previous && previous.analyticalRevision === snapshot.analyticalRevision) return history;
  return [...history, snapshot].slice(-50);
}

export function authorizeAnalyticalSnapshot(analytical, scoreVersion, installedAt) {
  if (!analytical) return null;
  return freeze({
    kind: "AUTHORIZED_DECISION",
    scoreVersion,
    installedAt,
    sourceAnalyticalRevision: analytical.analyticalRevision,
    formulaVersion: analytical.formulaVersion,
    weightsVersion: analytical.weightsVersion,
    setupState: analytical.setupState,
    setupModel: analytical.setupModel,
    authorizedComponents: clone(analytical.components),
    authorizedWeights: clone(analytical.weights),
    authorizedF: analytical.F,
    coverage: analytical.coverage,
    configuredWeight: analytical.configuredWeight,
    measuredWeight: analytical.measuredWeight,
    minimumPossibleScore: analytical.minimumPossibleScore,
    maximumPossibleScore: analytical.maximumPossibleScore,
  });
}

export function publishCurrentAnalyticalSnapshot(signal = {}) {
  const snapshot = signal.decisionScoreTelemetry?.currentAnalyticalSnapshot
    || signal.stockDecisionEvidence?.currentAnalyticalSnapshot
    || signal.currentAnalyticalSnapshot;
  if (!snapshot?.components?.discovery) return signal;
  const discovery = snapshot.components.discovery;
  const entry = snapshot.components.entry;
  signal.currentAnalyticalSnapshot = snapshot;
  signal.analyticalHistory = appendAnalyticalRevision(signal.analyticalHistory, snapshot);
  signal.analyticalRevision = snapshot.analyticalRevision;
  signal.earlyDiscoveryScore = signal.discoveryScorecard?.score ?? signal.earlyDiscoveryScore ?? null;
  signal.continuationSetupScore = snapshot.diagnostics?.continuationSetupScore ?? null;
  signal.discoverySource = discovery.source;
  signal.discoveryScore = discovery.score;
  signal.discoveryScoreAvailable = discovery.score !== null && discovery.state !== "DATA_UNAVAILABLE";
  if (entry) {
    signal.canonicalEntryScore = entry.score;
    signal.canonicalEntrySource = entry.source;
  }
  return signal;
}
