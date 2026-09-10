import {
  CRYPTO_MAX_ENTRY_SPREAD_PERCENT,
  calculateCryptoEntryQualityFromEvidence,
  getUniqueCryptoSessionDays,
  resolveCryptoLiquidityEvidence,
} from "./cryptoScoring.js";
import { isLiveQuoteSource } from "../live/liveQuoteCache.js";
import { normalizeCandidateQuote } from '../market-data/normalizeCandidateQuote.js';
import { assessCryptoSetup, cryptoSetupGate } from './cryptoSetup.js';
import { evaluateCryptoTradePlan } from './cryptoTradePlan.js';
import { getApprovedTradeAmount } from './approvedSizing.js';

// Immediate-entry F uses independent discovery, execution and context evidence.
// Multi-day continuation remains separate telemetry (and an acceleration gate),
// never a prerequisite or a default-value contribution to an immediate entry.
export const CRYPTO_DECISION_MODEL = 'CRYPTO_IMMEDIATE_ENTRY_V2';
export const CRYPTO_DECISION_WEIGHTS = Object.freeze({
  base: 0.45,
  execution: 0.40,
  runner: 0,
  strategyEvolution: 0.15,
});
export const CRYPTO_MIN_DECISION_COVERAGE = 0.8;
export const CRYPTO_MAX_DECISION_QUOTE_AGE_SECONDS = 5;
export const CRYPTO_MIN_FINAL_SCORE_TO_BUY = 65;

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
    if (value === undefined || value < 0 || value > 100) continue;
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
  const measured = signal.spreadAvailable !== false && explicitAvailability !== false && (quoteMeasured || (
    explicitAvailability !== false &&
      explicitAvailability === true &&
      providedSpread !== undefined &&
      providedSpread >= 0
  ));
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

export function buildCryptoDecisionScore(
  signal = {},
  {
    now = Date.now(),
    maxDiscoveryAgeMinutes = 15,
    maxQuoteAgeSeconds = CRYPTO_MAX_DECISION_QUOTE_AGE_SECONDS,
  } = {}
) {
  const effectiveMaxQuoteAgeSeconds = Math.min(
    CRYPTO_MAX_DECISION_QUOTE_AGE_SECONDS,
    Math.max(1, Number(maxQuoteAgeSeconds) || CRYPTO_MAX_DECISION_QUOTE_AGE_SECONDS)
  );
  signal = normalizeCandidateQuote(signal);
  const barsFound = Math.max(0, finiteNumber(signal.barsFound) || 0);
  const earlyDiscovery = resolveComponent([
    { value: signal.cryptoDiscoveryScorecard?.score, source: "cryptoDiscoveryScorecard.score" },
  ]);
  const setup = assessCryptoSetup(signal, { now });
  const setupGate = cryptoSetupGate(signal, { now });
  const continuationEntry = signal.scoringModelVersion === 'SMARTMONEY_CRYPTO_DECISION_V4' && setup.available && setup.eligible;
  const discovery = continuationEntry
    ? { value: setup.score, available: true, source: 'measured_crypto_continuation_setup' } : earlyDiscovery;
  const discoveryTimestampRaw = signal.cryptoDiscoveryScorecard?.calculatedAt;
  const discoveryTimestamp = discoveryTimestampRaw
    ? Date.parse(discoveryTimestampRaw)
    : NaN;
  const discoveryAgeMinutes = Number.isFinite(discoveryTimestamp)
    ? (Number(now) - discoveryTimestamp) / 60_000
    : null;
  const discoveryFresh = discoveryAgeMinutes !== null &&
    discoveryAgeMinutes >= -1 &&
    discoveryAgeMinutes <= Math.max(1, Number(maxDiscoveryAgeMinutes || 15));
  const quoteTimestampRaw =
    signal.liveQuote?.updatedAt ??
    signal.liveQuoteUpdatedAt ??
    signal.quoteFetchedAt;
  const quoteTimestamp = quoteTimestampRaw ? Date.parse(quoteTimestampRaw) : NaN;
  const quoteAgeSeconds = Number.isFinite(quoteTimestamp)
    ? (Number(now) - quoteTimestamp) / 1000
    : null;
  const quoteSource =
    signal.liveQuoteSource ||
    signal.liveQuote?.source ||
    signal.source ||
    "";
  const quoteSourceApproved = isLiveQuoteSource(quoteSource, "crypto");
  const quoteFresh =
    signal.priceIsLive === true &&
    quoteSourceApproved &&
    quoteAgeSeconds !== null &&
    quoteAgeSeconds >= -5 &&
    quoteAgeSeconds <= effectiveMaxQuoteAgeSeconds;
  const spread = calculateMeasuredSpread(signal);
  const spreadTimestampRaw =
    signal.spreadUpdatedAt ??
    signal.bidAskUpdatedAt;
  const spreadTimestamp = Number.isFinite(Number(spreadTimestampRaw))
    ? Number(spreadTimestampRaw)
    : spreadTimestampRaw
      ? Date.parse(spreadTimestampRaw)
      : NaN;
  const spreadAgeSeconds = Number.isFinite(spreadTimestamp)
    ? (Number(now) - spreadTimestamp) / 1000
    : null;
  const spreadSource = signal.spreadSource || quoteSource;
  const spreadSourceApproved = isLiveQuoteSource(spreadSource, "crypto");
  const spreadFresh =
    spread.measured &&
    spreadSourceApproved &&
    spreadAgeSeconds !== null &&
    spreadAgeSeconds >= -5 &&
    spreadAgeSeconds <= effectiveMaxQuoteAgeSeconds;
  const liquidity = resolveCryptoLiquidityEvidence(signal);
  const measuredEntryQuality = calculateCryptoEntryQualityFromEvidence({
    spreadAvailable: spread.measured,
    spreadPercent: spread.spreadPercent,
    liquidityEvidence: liquidity,
  });
  const entryQuality = {
    value: measuredEntryQuality.score,
    available: measuredEntryQuality.available && spreadFresh,
    source: measuredEntryQuality.available && spreadFresh
      ? `measured_spread+${liquidity.source}`
      : "unavailable_entry_evidence",
  };
  const recentDays = getUniqueCryptoSessionDays(signal.multiDayAccumulation?.seenDays || []).filter((day) => {
      const age = Number(now) - Date.parse(`${day}T00:00:00Z`);
      return day < new Date(now).toISOString().slice(0, 10) && age <= 14 * 86400000;
    });
  let seenDays = 0;
  if (recentDays.length && Number(now) - Date.parse(recentDays.at(-1)) <= 3 * 86400000) {
    seenDays = 1;
    for (let index = recentDays.length - 2; index >= 0; index--) {
      if (Date.parse(recentDays[index + 1]) - Date.parse(recentDays[index]) > 86400000) break;
      seenDays++;
    }
  }
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
    available: continuationValue.available && seenDays >= 2 && signal.continuationScorecard?.available !== false && signal.multiDayScoreAvailable !== false,
    source: continuationValue.available && seenDays >= 2 && signal.continuationScorecard?.available !== false && signal.multiDayScoreAvailable !== false
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
    // Missing evidence contributes zero instead of increasing the weight of
    // the remaining components. Absence must never improve a final score.
    normalizeMissing: false,
  });
  const componentsWithSemantics = weighted.components.map((component) => ({
    ...component,
    semanticName:
      components.find((source) => source.name === component.name)?.semanticName ||
      component.name,
  }));
  const missingCriticalEvidence = [
    ...(discovery.available ? [] : ["discovery"]),
    ...(Number(signal.cryptoDiscoveryScorecard?.coverage ?? 0) >= 0.65 &&
      Number(signal.cryptoDiscoveryScorecard?.coverage) <= 1
      ? []
      : ["discoveryCoverage"]),
    ...(discoveryFresh ? [] : ["freshDiscoveryScorecard"]),
    ...(signal.cryptoDiscoveryScorecard?.extension?.alreadyExtended === true && !continuationEntry
      ? ["multiHorizonExtension"]
      : []),
    ...(signal.newsCatalyst?.riskDetected === true ? ["negativeNewsRisk"] : []),
    ...(signal.newsCatalyst?.dataAvailable === true ? [] : ["newsRiskCoverage"]),
    ...(barsFound >= 10 ? [] : ["barHistory"]),
    ...(spread.measured ? [] : ["liveSpread"]),
    ...(spread.measured && !spreadFresh ? ["freshLiveSpread"] : []),
    ...(quoteSourceApproved ? [] : ["approvedLiveQuoteSource"]),
    ...(spreadSourceApproved ? [] : ["approvedLiveSpreadSource"]),
    ...(spread.measured && !spread.pass ? ["acceptableSpread"] : []),
    ...(liquidity.available ? [] : ["liquidity"]),
    ...(liquidity.pass ? [] : ["minimumLiquidity"]),
    ...(entryQuality.available ? [] : ["entryQuality"]),
    ...(weighted.coverage >= CRYPTO_MIN_DECISION_COVERAGE
      ? []
      : ["decisionCoverage"]),
    ...(quoteFresh ? [] : ["freshLiveQuote"]),
  ];
  const uniqueMissingCriticalEvidence = [...new Set(missingCriticalEvidence)];
  const coreEvidencePass = uniqueMissingCriticalEvidence.length === 0 &&
    (signal.scoringModelVersion !== 'SMARTMONEY_CRYPTO_DECISION_V4' || setupGate.approved);
  const measuredRejections = new Set(['multiHorizonExtension', 'negativeNewsRisk', 'acceptableSpread', 'minimumLiquidity']);
  const analysisEvidencePass = uniqueMissingCriticalEvidence.every(reason => measuredRejections.has(reason));

  return {
    model: CRYPTO_DECISION_MODEL,
    score: weighted.score,
    coverage: weighted.coverage,
    components: componentsWithSemantics,
    componentsByName: Object.fromEntries(
      componentsWithSemantics.map((component) => [component.name, component])
    ),
    missingComponents: weighted.missingComponents.filter(name => name !== 'runner'),
    missingCriticalEvidence: [...new Set([...uniqueMissingCriticalEvidence,
      ...(signal.scoringModelVersion === 'SMARTMONEY_CRYPTO_DECISION_V4' ? setupGate.reasons : [])])],
    coreEvidencePass,
    analysisEvidencePass,
    setup, setupGate: { approved: setupGate.approved, reasons: setupGate.reasons },
    opportunityBasis: continuationEntry ? setup.route : 'EARLY_DISCOVERY',
    earlyDiscovery,
    barsFound,
    spread,
    liquidity,
    contextObservations: context.observations || [],
    continuationEvidence: { seenDays, available: continuation.available, requiredForImmediateEntry: false },
    scoreStatus: coreEvidencePass
      ? "FINAL"
      : analysisEvidencePass ? 'FINAL_ANALYSIS_NOT_APPROVED' : "PROVISIONAL_INCOMPLETE_EVIDENCE",
    minimumDecisionCoverage: CRYPTO_MIN_DECISION_COVERAGE,
    quoteFreshness: {
      timestamp: Number.isFinite(quoteTimestamp)
        ? new Date(quoteTimestamp).toISOString()
        : null,
      ageSeconds: quoteAgeSeconds === null
        ? null
        : Number(quoteAgeSeconds.toFixed(2)),
      maximumAgeSeconds: effectiveMaxQuoteAgeSeconds,
      priceIsLive: signal.priceIsLive === true,
      source: quoteSource,
      sourceApproved: quoteSourceApproved,
      fresh: quoteFresh,
    },
    spreadFreshness: {
      timestamp: Number.isFinite(spreadTimestamp)
        ? new Date(spreadTimestamp).toISOString()
        : null,
      ageSeconds: spreadAgeSeconds === null
        ? null
        : Number(spreadAgeSeconds.toFixed(2)),
      source: spreadSource,
      sourceApproved: spreadSourceApproved,
      fresh: spreadFresh,
    },
    discoveryFreshness: {
      calculatedAt: Number.isFinite(discoveryTimestamp)
        ? new Date(discoveryTimestamp).toISOString()
        : null,
      ageMinutes: discoveryAgeMinutes === null
        ? null
        : Number(discoveryAgeMinutes.toFixed(2)),
      maximumAgeMinutes: Math.max(1, Number(maxDiscoveryAgeMinutes || 15)),
      fresh: discoveryFresh,
    },
  };
}

export function evaluateCryptoTradeCandidate(
  signal = {},
  {
    minimumScore = CRYPTO_MIN_FINAL_SCORE_TO_BUY,
    now = Date.now(),
    maxDiscoveryAgeMinutes = 15,
  } = {}
) {
  const evidence = buildCryptoDecisionScore(signal, { now, maxDiscoveryAgeMinutes });
  const centralEvidence = signal.centralAutonomousDecisionCore
    ?.cryptoDecisionEvidence;
  const resolvedScore = finiteNumber(
    signal.cryptoDecisionScore,
    signal.masterFinalScore,
    signal.finalAutonomousDecisionScore
  );
  const scoreAvailable =
    signal.cryptoDecisionScoreAvailable !== false &&
    resolvedScore !== undefined &&
    evidence.coreEvidencePass === true &&
    centralEvidence?.coreEvidencePass === true;
  // Quote refreshes may change entry quality between central scoring cycles.
  // A stored higher score must never override the evidence being evaluated now.
  const score = scoreAvailable ? evidence.score : 0;
  const decisionTime = Date.parse(String(signal.decisionUpdatedAt ||
    signal.centralAutonomousDecisionCore?.updatedAt || ""));
  const decisionFresh = Number.isFinite(decisionTime) && decisionTime <= Number(now) + 5000 &&
    Number(now) - decisionTime <= 15 * 60000;
  const centralAction = String(signal.centralAutonomousAction || signal.centralAutonomousDecisionCore?.action || "").toUpperCase();
  const reasons = [
    ...cryptoSetupGate(signal, { now }).reasons,
    ...(signal.scoringModelVersion === 'SMARTMONEY_CRYPTO_DECISION_V4' && getApprovedTradeAmount(signal) > 0
      ? evaluateCryptoTradePlan(signal, { now, notional: getApprovedTradeAmount(signal) }).reasons : []),
    ...(signal.blockBuying === true ? ['BUYING_BLOCKED'] : []),
    ...(signal.displayOnly === true ? ['DISPLAY_ONLY'] : []),
    ...(signal.centralCoreHardBlock === true ? ['CENTRAL_HARD_BLOCK'] : []),
    ...(signal.finalSizingReconciliation?.finalBlocked === true ? ['SIZING_BLOCKED'] : []),
    ...(signal.globalRiskOffDefense?.shouldBlock === true ? ['GLOBAL_RISK_OFF'] : []),
    ...(signal.shouldWaitForPullback === true ? ['WAIT_FOR_PULLBACK'] : []),
    ...(signal.finalMasterDecisionProfile?.suppressEntry === true ? ['ENTRY_SUPPRESSED'] : []),
    ...(decisionFresh ? [] : ["CENTRAL_DECISION_EXPIRED_OR_UNDATED"]),
    ...(signal.setupRevalidationRequired === true ? ["SETUP_PRICE_MOVED_RESCAN_REQUIRED"] : []),
    ...(["ALLOW", "ALLOW_REDUCED_SIZE", "ACCELERATE_CAPITAL"].includes(centralAction) ? [] : ["CENTRAL_DECISION_NOT_APPROVED"]),
    ...(centralEvidence?.coreEvidencePass === true
      ? []
      : [centralEvidence ? "CENTRAL_CRYPTO_EVIDENCE_FAILED" : "MISSING_CENTRAL_CRYPTO_EVIDENCE"]),
    ...(evidence.coreEvidencePass ? [] : evidence.missingCriticalEvidence),
    ...(signal.qualifiedToBuy === true ? [] : ["NOT_QUALIFIED_TO_BUY"]),
    ...(signal.autoTradeApproved === true ? [] : ["AUTO_TRADE_NOT_APPROVED"]),
    ...(signal.approved === true ? [] : ["FINAL_APPROVAL_MISSING"]),
    ...(signal.backendApproved === true ? [] : ["BACKEND_APPROVAL_MISSING"]),
    ...(scoreAvailable ? [] : ["DECISION_SCORE_INVALID"]),
    ...(score >= Number(minimumScore || 0) && resolvedScore >= Number(minimumScore || 0)
      ? [] : ["DECISION_SCORE_BELOW_THRESHOLD"]),
  ];
  return {
    approved: reasons.length === 0,
    score,
    minimumScore: Number(minimumScore || 0),
    scoreAvailable,
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
    (sum, component) => sum + (
      component.available ? component.value * component.weight : 0
    ),
    0
  );
  const score = normalizeMissing && includedWeight > 0
    ? weightedTotal / includedWeight
    : weightedTotal;
  const componentsWithContributions = telemetry.map((component) => {
    const includedComponent = component.available;
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
