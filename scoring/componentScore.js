import {
  CRYPTO_MAX_ENTRY_SPREAD_PERCENT,
  calculateCryptoEntryQualityFromEvidence,
  getUniqueCryptoSessionDays,
  resolveCryptoLiquidityEvidence,
} from "./cryptoScoring.js";

// Crypto decision scoring intentionally uses one component per independent
// evidence family. Liquidity/spread are represented only by entry quality;
// momentum is represented only by discovery; multi-timeframe evidence is
// represented only by continuation.
export const CRYPTO_DECISION_WEIGHTS = Object.freeze({
  base: 0.35,
  execution: 0.30,
  runner: 0.20,
  strategyEvolution: 0.15,
});

function finiteNumber(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function positiveFiniteNumber(...values) {
  for (const value of values) {
    const parsed = finiteNumber(value);
    if (parsed !== undefined && parsed > 0) return parsed;
  }
  return undefined;
}

function clampScore(value) {
  return Math.max(0, Math.min(100, Number(value) || 0));
}

function resolveComponent(candidates = []) {
  for (const candidate of candidates) {
    const value = finiteNumber(candidate?.value);
    if (value === undefined) continue;
    return {
      value: clampScore(value),
      available: true,
      source: String(candidate.source || "unknown"),
    };
  }
  return { value: 0, available: false, source: "unavailable" };
}

function calculateMeasuredSpread(signal = {}) {
  const bid = positiveFiniteNumber(signal.bid);
  const ask = positiveFiniteNumber(signal.ask);
  const referencePrice = bid !== undefined && ask !== undefined
    ? (bid + ask) / 2
    : positiveFiniteNumber(signal.current, signal.price, signal.livePrice);
  const quoteMeasured =
    bid !== undefined &&
    ask !== undefined &&
    ask >= bid &&
    referencePrice !== undefined;
  const providedSpread = finiteNumber(
    signal.cryptoRealism?.spreadPercent,
    signal.spreadPercent
  );
  const explicitAvailability =
    typeof signal.cryptoRealism?.spreadAvailable === "boolean"
      ? signal.cryptoRealism.spreadAvailable
      : typeof signal.spreadAvailable === "boolean"
        ? signal.spreadAvailable
        : undefined;
  const measured = quoteMeasured || (
    explicitAvailability !== false &&
      explicitAvailability === true &&
      providedSpread !== undefined &&
      providedSpread >= 0
  );
  const spreadPercent = !measured
    ? undefined
    : quoteMeasured
      ? ((ask - bid) / referencePrice) * 100
      : providedSpread;
  return {
    measured,
    pass:
      measured &&
      spreadPercent !== undefined &&
      spreadPercent <= CRYPTO_MAX_ENTRY_SPREAD_PERCENT,
    spreadPercent: spreadPercent === undefined
      ? null
      : Number(spreadPercent.toFixed(4)),
  };
}

function getObservationAdjustment(signal, phase) {
  const observation = signal?.cryptoScoreObservations?.[phase];
  const adjustment = finiteNumber(observation?.adjustment);
  return adjustment === undefined ? null : adjustment;
}

function calculateBoundedContext(signal = {}) {
  const excludedPhases = [
    "phase43",
    "phase48",
    "phase49",
    "phase50",
    "phase52",
    "cryptoReinforcement",
  ];
  const observations = excludedPhases
    .map((phase) => ({
      phase,
      adjustment: getObservationAdjustment(signal, phase),
      included: false,
      reason: "correlated_with_discovery_or_entry",
    }))
    .filter((item) => item.adjustment !== null);
  const scorecard = signal.cryptoContextScorecard;
  const explicitScore = scorecard?.independent === true
    ? finiteNumber(scorecard.score)
    : undefined;
  if (explicitScore === undefined) {
    return { value: 0, available: false, source: "unavailable", observations };
  }
  return {
    value: clampScore(explicitScore),
    available: true,
    source: String(scorecard.source || "independent_crypto_context"),
    observations,
  };
}

export function buildCryptoDecisionScore(signal = {}) {
  const barsFound = Math.max(0, finiteNumber(signal.barsFound) || 0);
  const discovery = resolveComponent([
    { value: signal.rawCryptoScore, source: "rawCryptoScore" },
    { value: signal.scannerScore, source: "scannerScore" },
    { value: signal.score, source: "score" },
  ]);
  const spread = calculateMeasuredSpread(signal);
  const liquidity = resolveCryptoLiquidityEvidence(signal);
  const measuredEntryQuality = calculateCryptoEntryQualityFromEvidence({
    spreadAvailable: spread.measured,
    spreadPercent: spread.spreadPercent,
    liquidityEvidence: liquidity,
  });
  const entryQuality = {
    value: measuredEntryQuality.score,
    available: measuredEntryQuality.available,
    source: measuredEntryQuality.available
      ? `measured_spread+${liquidity.source}`
      : "unavailable_entry_evidence",
  };
  const seenDays = Array.isArray(signal.multiDayAccumulation?.seenDays)
    ? getUniqueCryptoSessionDays(signal.multiDayAccumulation.seenDays).length
    : Math.max(
      0,
      finiteNumber(
        signal.multiDayAccumulation?.seenDaysCount,
        signal.multiDayContinuation?.observedSessions,
        signal.observedSessionCount
      ) || 0
    );
  const continuationValue = resolveComponent([
    {
      value: signal.continuationScorecard?.score,
      source: "continuationScorecard.score",
    },
    {
      value: signal.multiDayContinuationScore,
      source: "multiDayContinuationScore",
    },
    { value: signal.multiDayScore, source: "multiDayScore" },
  ]);
  const continuation = {
    ...continuationValue,
    available: continuationValue.available && seenDays >= 2,
    source: continuationValue.available && seenDays >= 2
      ? continuationValue.source
      : "unavailable_continuation_evidence",
  };
  const context = calculateBoundedContext(signal);
  const components = [
    {
      name: "base",
      semanticName: "discovery",
      ...discovery,
      weight: CRYPTO_DECISION_WEIGHTS.base,
    },
    {
      name: "execution",
      semanticName: "entryQuality",
      ...entryQuality,
      weight: CRYPTO_DECISION_WEIGHTS.execution,
    },
    {
      name: "runner",
      semanticName: "continuation",
      ...continuation,
      weight: CRYPTO_DECISION_WEIGHTS.runner,
    },
    {
      name: "strategyEvolution",
      semanticName: "context",
      ...context,
      weight: CRYPTO_DECISION_WEIGHTS.strategyEvolution,
    },
  ];
  const weighted = calculateAvailableWeightedScore(components, {
    normalizeMissing: true,
  });
  const componentsWithSemantics = weighted.components.map((component) => ({
    ...component,
    semanticName:
      components.find((source) => source.name === component.name)?.semanticName ||
      component.name,
  }));
  const missingCriticalEvidence = [
    ...(discovery.available ? [] : ["discovery"]),
    ...(barsFound >= 10 ? [] : ["barHistory"]),
    ...(spread.measured ? [] : ["liveSpread"]),
    ...(spread.measured && !spread.pass ? ["acceptableSpread"] : []),
    ...(liquidity.available ? [] : ["liquidity"]),
    ...(liquidity.pass ? [] : ["minimumLiquidity"]),
    ...(entryQuality.available ? [] : ["entryQuality"]),
  ];

  return {
    score: weighted.score,
    coverage: weighted.coverage,
    components: componentsWithSemantics,
    componentsByName: Object.fromEntries(
      componentsWithSemantics.map((component) => [component.name, component])
    ),
    missingComponents: weighted.missingComponents,
    missingCriticalEvidence: [...new Set(missingCriticalEvidence)],
    coreEvidencePass: missingCriticalEvidence.length === 0,
    barsFound,
    spread,
    liquidity,
    contextObservations: context.observations || [],
    continuationEvidence: { seenDays },
  };
}

export function evaluateCryptoTradeCandidate(
  signal = {},
  { minimumScore = 70 } = {}
) {
  const evidence = buildCryptoDecisionScore(signal);
  const centralEvidence = signal.centralAutonomousDecisionCore
    ?.cryptoDecisionEvidence;
  const score = finiteNumber(
    signal.masterFinalScore,
    signal.cryptoDecisionScore,
    signal.finalAutonomousDecisionScore,
    signal.score
  ) || 0;
  const reasons = [
    ...(centralEvidence?.coreEvidencePass === true
      ? []
      : [centralEvidence ? "CENTRAL_CRYPTO_EVIDENCE_FAILED" : "MISSING_CENTRAL_CRYPTO_EVIDENCE"]),
    ...(evidence.coreEvidencePass ? [] : evidence.missingCriticalEvidence),
    ...(signal.qualifiedToBuy === true ? [] : ["NOT_QUALIFIED_TO_BUY"]),
    ...(signal.autoTradeApproved === true ? [] : ["AUTO_TRADE_NOT_APPROVED"]),
    ...(score >= Number(minimumScore || 0) ? [] : ["DECISION_SCORE_BELOW_THRESHOLD"]),
  ];
  return {
    approved: reasons.length === 0,
    score,
    minimumScore: Number(minimumScore || 0),
    reasons: [...new Set(reasons)],
    evidence,
    centralEvidenceAvailable: Boolean(centralEvidence),
  };
}

export function calculateAvailableWeightedScore(
  components = [],
  { normalizeMissing = false } = {}
) {
  const telemetry = components.map((component) => {
    const parsedValue = Number(component.value);
    const parsedWeight = Number(component.weight);
    return {
      name: String(component.name || "unknown"),
      source: String(component.source || component.name || "unknown"),
      available: component.available !== false && Number.isFinite(parsedValue),
      value: Number.isFinite(parsedValue) ? parsedValue : 0,
      weight: Number.isFinite(parsedWeight) && parsedWeight > 0 ? parsedWeight : 0,
    };
  });
  const included = normalizeMissing
    ? telemetry.filter((component) => component.available)
    : telemetry;
  const includedWeight = included.reduce((sum, component) => sum + component.weight, 0);
  const configuredWeight = telemetry.reduce((sum, component) => sum + component.weight, 0);
  const availableWeight = telemetry
    .filter((component) => component.available)
    .reduce((sum, component) => sum + component.weight, 0);
  const weightedTotal = included.reduce(
    (sum, component) => sum + component.value * component.weight,
    0
  );
  const score = normalizeMissing && includedWeight > 0
    ? weightedTotal / includedWeight
    : weightedTotal;
  const componentsWithContributions = telemetry.map((component) => {
    const includedComponent = !normalizeMissing || component.available;
    const normalizedWeight = includedComponent && includedWeight > 0
      ? normalizeMissing
        ? component.weight / includedWeight
        : component.weight
      : 0;
    return {
      ...component,
      normalizedWeight: Number(normalizedWeight.toFixed(4)),
      contribution: Number((component.value * normalizedWeight).toFixed(2)),
    };
  });

  return {
    score: Number(score.toFixed(2)),
    coverage: configuredWeight > 0
      ? Number((availableWeight / configuredWeight).toFixed(2))
      : 0,
    includedWeight: Number(includedWeight.toFixed(4)),
    configuredWeight: Number(configuredWeight.toFixed(4)),
    missingComponents: componentsWithContributions
      .filter((component) => !component.available)
      .map((component) => component.name),
    components: componentsWithContributions,
  };
}
