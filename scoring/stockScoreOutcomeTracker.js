import {
  addUsStockMarketSessionDays,
  isUsStockMarketSessionDayKey,
} from "../utils/usMarketCalendar.js";

import { validateQuietLearning } from './quietLearningValidation.js';

const ET_TIME_ZONE = "America/New_York";
const DEFAULT_MAX_OBSERVATIONS = 500;
const DEFAULT_MAX_NEW_PER_CYCLE = Number.MAX_SAFE_INTEGER;
const HORIZONS = Object.freeze([
  ["fiveMinute", 5 * 60 * 1000],
  ["fifteenMinute", 15 * 60 * 1000],
  ["thirtyMinute", 30 * 60 * 1000],
  ["oneHour", 60 * 60 * 1000],
  ["close", null],
  ["oneDay", null],
  ["threeDay", null],
  ["fiveDay", null],
]);

const zonedPartsFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: ET_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

const offsetFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: ET_TIME_ZONE,
  timeZoneName: "shortOffset",
});

function getEtParts(timestampMs) {
  return Object.fromEntries(
    zonedPartsFormatter
      .formatToParts(new Date(timestampMs))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)])
  );
}

function getEtDayKey(timestampMs) {
  const parts = getEtParts(timestampMs);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function getEtOffsetMinutes(timestampMs) {
  const value = offsetFormatter
    .formatToParts(new Date(timestampMs))
    .find((part) => part.type === "timeZoneName")?.value || "GMT";
  const match = value.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/i);
  if (!match) return 0;
  const direction = match[1] === "+" ? 1 : -1;
  return direction * (Number(match[2]) * 60 + Number(match[3] || 0));
}

function etLocalToUtcMs({ year, month, day, hour = 16, minute = 0 }) {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  const firstPass = utcGuess - getEtOffsetMinutes(utcGuess) * 60 * 1000;
  return utcGuess - getEtOffsetMinutes(firstPass) * 60 * 1000;
}

function nextMarketCloseTarget(timestampMs) {
  const parts = getEtParts(timestampMs);
  const dayKey = `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
  const beforeClose = parts.hour * 60 + parts.minute < 16 * 60;
  const targetDate = isUsStockMarketSessionDayKey(dayKey) && beforeClose
    ? parts
    : addUsStockMarketSessionDays(parts, 1);
  return etLocalToUtcMs(targetDate);
}

function buildTargets(timestampMs) {
  const parts = getEtParts(timestampMs);
  return {
    fiveMinute: timestampMs + 5 * 60 * 1000,
    fifteenMinute: timestampMs + 15 * 60 * 1000,
    thirtyMinute: timestampMs + 30 * 60 * 1000,
    oneHour: timestampMs + 60 * 60 * 1000,
    close: nextMarketCloseTarget(timestampMs),
    oneDay: etLocalToUtcMs(addUsStockMarketSessionDays(parts, 1)),
    threeDay: etLocalToUtcMs(addUsStockMarketSessionDays(parts, 3)),
    fiveDay: etLocalToUtcMs(addUsStockMarketSessionDays(parts, 5)),
  };
}

function normalizeSymbol(value) {
  return String(value || "").trim().toUpperCase();
}

function resolvePrice(signal = {}) {
  const price = Number(
    signal.livePrice ||
    signal.current ||
    signal.price ||
    signal.displayPrice ||
    signal.c ||
    0
  );
  return Number.isFinite(price) && price > 0 ? price : 0;
}

function resolveScore(signal = {}) {
  const raw = signal.currentAnalyticalScore ??
    signal.stockDecisionScore ??
    signal.decisionScoreTelemetry?.scores?.decision ??
    null;
  if (raw === null || raw === undefined || raw === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : null;
}

export function measurePricePath(baselinePrice, prints = [], { spreadPercent = null } = {}) {
  const baseline = Number(baselinePrice);
  const usable = Array.isArray(prints)
    ? prints.filter((print) => Number(print?.price) > 0)
    : [];
  if (!(baseline > 0) || usable.length === 0) {
    return {
      maximumFavorableExcursion: null,
      maximumAdverseExcursion: null,
      timeToPeakMs: null,
      hitPlus3: null,
      hitPlus5: null,
      hitPlus10: null,
      hitMinus2: null,
      hitMinus5: null,
      spreadPercent: Number.isFinite(Number(spreadPercent)) ? Number(spreadPercent) : null,
      netResultPercent: null,
    };
  }
  let peak = baseline;
  let trough = baseline;
  let peakAt = Number(usable[0].at);
  for (const print of usable) {
    const price = Number(print.price);
    if (price > peak) {
      peak = price;
      peakAt = Number(print.at);
    }
    if (price < trough) trough = price;
  }
  const favorable = ((peak - baseline) / baseline) * 100;
  const adverse = ((trough - baseline) / baseline) * 100;
  const last = Number(usable[usable.length - 1].price);
  const rawReturn = ((last - baseline) / baseline) * 100;
  const spread = Number(spreadPercent);
  const spreadKnown = Number.isFinite(spread);
  return {
    maximumFavorableExcursion: round(favorable, 4),
    maximumAdverseExcursion: round(adverse, 4),
    timeToPeakMs: Number.isFinite(peakAt) && Number.isFinite(Number(usable[0].at))
      ? peakAt - Number(usable[0].at)
      : null,
    hitPlus3: favorable >= 3,
    hitPlus5: favorable >= 5,
    hitPlus10: favorable >= 10,
    hitMinus2: adverse <= -2,
    hitMinus5: adverse <= -5,
    spreadPercent: spreadKnown ? spread : null,
    netResultPercent: spreadKnown ? round(rawReturn - spread, 4) : null,
  };
}

export function finalScoreBucket(score) {
  if (score === null || !Number.isFinite(Number(score))) return "F_UNKNOWN";
  const value = Number(score);
  if (value >= 85) return "F85+";
  if (value >= 80) return "F80-84";
  if (value >= 75) return "F75-79";
  if (value >= 70) return "F70-74";
  if (value >= 65) return "F65-69";
  if (value >= 60) return "F60-64";
  if (value >= 55) return "F55-59";
  if (value >= 50) return "F50-54";
  return "F_BELOW_50";
}

function resolveScoreBand(_signal, score) {
  return finalScoreBucket(score);
}

function round(value, digits = 4) {
  const factor = 10 ** digits;
  return Math.round(Number(value || 0) * factor) / factor;
}

function measuredPathFields(baselinePrice, signal = {}) {
  const measured = measurePricePath(baselinePrice, signal.pricePath, {
    spreadPercent: signal.measuredSpreadPercent ?? signal.spreadPercent,
  });
  return {
    maximumFavorableExcursion: measured.maximumFavorableExcursion,
    maximumAdverseExcursion: measured.maximumAdverseExcursion,
    timeToPeakMs: measured.timeToPeakMs,
    hitPlus3: measured.hitPlus3,
    hitPlus5: measured.hitPlus5,
    hitPlus10: measured.hitPlus10,
    hitMinus2: measured.hitMinus2,
    hitMinus5: measured.hitMinus5,
    spreadAdjustedReturn: measured.netResultPercent,
    netResultPercent: measured.netResultPercent,
    retunesThreshold: false,
  };
}

function optionalScore(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? round(Math.max(0, Math.min(100, parsed)), 2) : null;
}

function decisionComponentScores(signal = {}) {
  const components =
    signal.decisionScoreTelemetry?.stages?.decision?.components ||
    signal.centralAutonomousDecisionCore?.scoreComponents ||
    [];
  const byName = Object.fromEntries(
    (Array.isArray(components) ? components : [])
      .filter((item) => item?.name)
      .map((item) => [item.name, item.available === false ? null : optionalScore(item.value)])
  );
  const readComponent = (name, fallback) =>
    Object.hasOwn(byName, name)
      ? optionalScore(byName[name])
      : optionalScore(fallback);
  return {
    discovery: readComponent(
      "discovery",
      signal.discoveryScore ?? signal.discoveryScorecard?.score
    ),
    entry: readComponent(
      "entry",
      signal.entryQualityScore ?? signal.entryQualityScorecard?.score
    ),
    marketContext: readComponent("marketContext", null),
    riskPortfolio: readComponent("riskPortfolio", null),
    fundamentals: readComponent("fundamentals", null),
  };
}

function buildSummary(observations) {
  const summary = {};
  for (const observation of observations) {
    const scoreBand = observation.scoreBand || "RESEARCH";
    summary[scoreBand] ||= {};
    for (const [horizon] of HORIZONS) {
      const measurement = observation.measurements?.[horizon];
      if (!measurement) continue;
      const bucket = summary[scoreBand][horizon] || {
        count: 0,
        wins: 0,
        totalReturnPercent: 0,
        bestReturnPercent: null,
        worstReturnPercent: null,
      };
      const value = Number(measurement.returnPercent || 0);
      bucket.count += 1;
      bucket.wins += value > 0 ? 1 : 0;
      bucket.totalReturnPercent += value;
      bucket.bestReturnPercent = bucket.bestReturnPercent === null
        ? value
        : Math.max(bucket.bestReturnPercent, value);
      bucket.worstReturnPercent = bucket.worstReturnPercent === null
        ? value
        : Math.min(bucket.worstReturnPercent, value);
      summary[scoreBand][horizon] = bucket;
    }
  }

  for (const band of Object.values(summary)) {
    for (const bucket of Object.values(band)) {
      bucket.winRate = round((bucket.wins / bucket.count) * 100, 2);
      bucket.averageReturnPercent = round(
        bucket.totalReturnPercent / bucket.count,
        4
      );
      bucket.bestReturnPercent = round(bucket.bestReturnPercent, 4);
      bucket.worstReturnPercent = round(bucket.worstReturnPercent, 4);
      delete bucket.totalReturnPercent;
    }
  }
  return summary;
}

export function updateStockScoreOutcomes(
  previousState = {},
  signals = [],
  {
    now = Date.now(),
    maxObservations = DEFAULT_MAX_OBSERVATIONS,
    maxNewPerCycle = DEFAULT_MAX_NEW_PER_CYCLE,
    maxFollowupQuoteAgeMs = 30 * 60 * 1000,
  } = {}
) {
  const safeMax = Math.max(1, Number(maxObservations || DEFAULT_MAX_OBSERVATIONS));
  const pricesBySymbol = new Map(
    (Array.isArray(signals) ? signals : [])
      .map((signal) => [
        normalizeSymbol(signal?.symbol),
        {
          price: resolvePrice(signal),
          source: String(
            signal?.liveQuoteSource ||
            signal?.source ||
            (signal?.outcomeFollowupOnly ? "outcome_followup" : "current_scan")
          ),
          outcomeFollowupOnly: signal?.outcomeFollowupOnly === true,
          quoteTimestampMs: Number.isFinite(Number(signal?.quoteTimestampMs))
            ? Number(signal.quoteTimestampMs)
            : Date.parse(String(
              signal?.liveQuoteUpdatedAt ||
              signal?.quoteFetchedAt ||
              signal?.updatedAt ||
              ""
            )),
        },
      ])
      .filter(([symbol, value]) => symbol && value.price > 0)
  );
  const observations = (Array.isArray(previousState?.observations)
    ? previousState.observations
    : [])
    .filter((observation) => observation?.symbol && observation?.baselinePrice > 0)
    .map((observation) => ({
      ...observation,
      targets: { ...(observation.targets || {}) },
      measurements: { ...(observation.measurements || {}) },
    }));

  for (const observation of observations) {
    const currentQuote = pricesBySymbol.get(normalizeSymbol(observation.symbol));
    if (!currentQuote?.price) continue;
    const currentPrice = currentQuote.price;
    const providerTimestampMs = Number(currentQuote.quoteTimestampMs);
    const providerTimestampAvailable = Number.isFinite(providerTimestampMs);
    if (
      currentQuote.outcomeFollowupOnly &&
      (
        !providerTimestampAvailable ||
        providerTimestampMs > now + 5_000 ||
        now - providerTimestampMs > Math.max(1, Number(maxFollowupQuoteAgeMs))
      )
    ) continue;
    const measuredAt = providerTimestampAvailable ? providerTimestampMs : now;
    for (const [horizon] of HORIZONS) {
      const targetAt = Number(observation.targets?.[horizon] || 0);
      if (
        targetAt > 0 &&
        now >= targetAt &&
        measuredAt >= targetAt &&
        !observation.measurements[horizon]
      ) {
        observation.measurements[horizon] = {
          targetAt,
          measuredAt,
          delayMinutes: round((measuredAt - targetAt) / (60 * 1000), 2),
          price: round(currentPrice, 6),
          quoteSource: currentQuote.source,
          returnPercent: round(
            ((currentPrice - observation.baselinePrice) /
              observation.baselinePrice) * 100,
            4
          ),
        };
      }
    }
  }

  const observedDay = getEtDayKey(now);
  const existingKeys = new Set(
    observations.map((observation) => `${observation.symbol}:${observation.observedDay}`)
  );
  const newCandidates = (Array.isArray(signals) ? signals : [])
    .map((signal) => ({
      signal,
      symbol: normalizeSymbol(signal?.symbol),
      price: resolvePrice(signal),
      score: resolveScore(signal),
    }))
    .filter(({ signal, symbol, price }) =>
      isUsStockMarketSessionDayKey(observedDay) &&
      signal?.outcomeFollowupOnly !== true &&
      symbol &&
      price > 0 &&
      !existingKeys.has(`${symbol}:${observedDay}`)
    )
    .sort((a, b) => Number(b.signal?.buyable === true) - Number(a.signal?.buyable === true) || (b.score ?? -1) - (a.score ?? -1))
    .slice(0, Math.max(0, Number(maxNewPerCycle || 0)));

  for (const { signal, symbol, price, score } of newCandidates) {
    observations.push({
      id: `${symbol}:${observedDay}`,
      symbol,
      observedDay,
      observedAt: now,
      executionCostModelVersion: 1,
      estimatedRoundTripCostPercent: 0.25,
      baselinePrice: round(price, 6),
      scoreBand: resolveScoreBand(signal, score),
      finalScore: score === null ? null : round(score, 2),
      rejected: signal.buyable !== true,
      blocker: signal.buyBlockReason || signal.funnel?.blocker || null,
      discoveryScore: optionalScore(signal.discoveryScore ?? signal.discoveryScorecard?.score),
      entryScore: optionalScore(signal.entryQualityScore ?? signal.entryQualityScorecard?.score),
      maximumPossibleF: optionalScore(signal.maximumPossibleF),
      decisionCoverage: optionalScore(signal.decisionCoverage),
      firstSeenAt: signal.firstSeenAt || null,
      ...measuredPathFields(price, signal),
      retunesThreshold: false,
      continuationScore: optionalScore(signal.multiDayContinuationScore ?? signal.continuationScorecard?.score),
      componentScores: decisionComponentScores(signal),
      componentWeights: signal.decisionScoreTelemetry?.stages?.decision?.effectiveWeights || signal.stockDecisionEvidence?.effectiveWeights || {},
      targets: buildTargets(now),
      measurements: {},
    });
  }

  const boundedObservations = observations
    .sort((a, b) => Number(b.observedAt || 0) - Number(a.observedAt || 0))
    .slice(0, safeMax);
  const completedCount = boundedObservations.filter((observation) =>
    HORIZONS.every(([horizon]) => observation.measurements?.[horizon])
  ).length;

  return {
    version: 1,
    updatedAt: new Date(now).toISOString(),
    maxObservations: safeMax,
    observationCount: boundedObservations.length,
    completedCount,
    pendingCount: boundedObservations.length - completedCount,
    learningTrainingCutoffAt: previousState?.learningTrainingCutoffAt || null,
    horizons: HORIZONS.map(([name]) => name),
    summary: buildSummary(boundedObservations),
    observations: boundedObservations,
  };
}

export function getDueStockOutcomeSymbols(
  outcomeState = {},
  currentSignals = [],
  {
    now = Date.now(),
    maxSymbols = 20,
    lastAttemptBySymbol = {},
    retryDelayMs = 15 * 60 * 1000,
  } = {}
) {
  const currentSymbols = new Set(
    (Array.isArray(currentSignals) ? currentSignals : [])
      .filter((signal) => resolvePrice(signal) > 0)
      .map((signal) => normalizeSymbol(signal?.symbol))
      .filter(Boolean)
  );
  const due = [];
  for (const observation of Array.isArray(outcomeState?.observations)
    ? outcomeState.observations
    : []) {
    const symbol = normalizeSymbol(observation?.symbol);
    if (!symbol || currentSymbols.has(symbol)) continue;
    const lastAttempt = Number(lastAttemptBySymbol?.[symbol] || 0);
    if (lastAttempt > 0 && now - lastAttempt < retryDelayMs) continue;
    const dueTargets = HORIZONS
      .map(([horizon]) => ({
        horizon,
        targetAt: Number(observation.targets?.[horizon] || 0),
      }))
      .filter(({ horizon, targetAt }) =>
        targetAt > 0 &&
        targetAt <= now &&
        !observation.measurements?.[horizon]
      );
    if (dueTargets.length === 0) continue;
    due.push({
      symbol,
      earliestTargetAt: Math.min(...dueTargets.map((target) => target.targetAt)),
    });
  }
  return [...new Map(
    due
      .sort((a, b) => a.earliestTargetAt - b.earliestTargetAt)
      .map((item) => [item.symbol, item])
  ).values()]
    .slice(0, Math.max(0, Number(maxSymbols || 0)))
    .map((item) => item.symbol);
}

function pearsonCorrelation(pairs) {
  if (!Array.isArray(pairs) || pairs.length < 2) return 0;
  const meanX = pairs.reduce((sum, item) => sum + item.x, 0) / pairs.length;
  const meanY = pairs.reduce((sum, item) => sum + item.y, 0) / pairs.length;
  let covariance = 0;
  let varianceX = 0;
  let varianceY = 0;
  for (const item of pairs) {
    const deltaX = item.x - meanX;
    const deltaY = item.y - meanY;
    covariance += deltaX * deltaY;
    varianceX += deltaX ** 2;
    varianceY += deltaY ** 2;
  }
  const denominator = Math.sqrt(varianceX * varianceY);
  return denominator > 0 ? covariance / denominator : 0;
}

export function calculateStockOutcomeLearning(
  outcomeState = {},
  {
    horizon = "oneDay",
    minSamples = 30,
    minMeasurementCoverage = 0.9,
    minUniqueSymbols = 10,
    maxMeasurementDelayMinutes = 360,
  } = {}
) {
  const observations = Array.isArray(outcomeState?.observations)
    ? outcomeState.observations
    : [];
  const evaluatedAt = Date.parse(outcomeState?.updatedAt || "") || Date.now();
  const dueObservations = observations.filter(
    (observation) => {
      const targetAt = Number(observation.targets?.[horizon] || 0);
      return targetAt > 0 && targetAt <= evaluatedAt;
    }
  );
  const measuredObservations = dueObservations.filter((observation) => {
    const measurement = observation.measurements?.[horizon];
    return measurement && measurement.returnPercent !== null && measurement.returnPercent !== undefined && measurement.returnPercent !== '' &&
      Number.isFinite(Number(measurement.returnPercent)) &&
      Number(measurement.delayMinutes || 0) <= maxMeasurementDelayMinutes;
  });
  const measurementCoverage = dueObservations.length > 0
    ? measuredObservations.length / dueObservations.length
    : 0;
  const enoughSamples = measuredObservations.length >= minSamples;
  const uniqueSymbolCount = new Set(
    measuredObservations.map((observation) => normalizeSymbol(observation.symbol))
  ).size;
  const diversityPass = uniqueSymbolCount >= minUniqueSymbols;
  const coveragePass = measurementCoverage >= minMeasurementCoverage;
  const validation = validateQuietLearning(measuredObservations.map(observation => ({
    ...observation,
    measurements: { [horizon]: {
      closeReturnPercent: observation.measurements[horizon].returnPercent,
      evidenceTimestamp: observation.measurements[horizon].measuredAt,
    } },
  })), horizon, Math.max(30, minSamples), outcomeState.learningTrainingCutoffAt, 0.05);
  const active = enoughSamples && coveragePass && diversityPass && validation.active;
  const componentNames = [
    "discovery",
    "entry",
    "marketContext",
    "riskPortfolio",
    "fundamentals",
  ];
  const componentCorrelations = {};
  const componentMultipliers = {};
  for (const name of componentNames) {
    const pairs = measuredObservations
      .map((observation) => {
        const componentValue = observation.componentScores?.[name];
        return {
          x: componentValue === null || componentValue === undefined
            ? Number.NaN
            : Number(componentValue),
          y: Number(observation.measurements?.[horizon]?.returnPercent),
        };
      })
      .filter((item) => Number.isFinite(item.x) && Number.isFinite(item.y));
    const correlation = pairs.length >= minSamples
      ? pearsonCorrelation(pairs)
      : 0;
    componentCorrelations[name] = {
      sampleCount: pairs.length,
      correlation: round(correlation, 4),
    };
    componentMultipliers[name] = active && pairs.length >= minSamples
      ? Math.max(0.95, Math.min(1.05, validation.componentMultipliers[name] ?? 1))
      : 1;
  }

  return {
    version: 2,
    learningPolicyVersion: 2,
    validation,
    calculatedAt: new Date(evaluatedAt).toISOString(),
    active,
    horizon,
    minimumSamples: minSamples,
    sampleCount: measuredObservations.length,
    uniqueSymbolCount,
    minimumUniqueSymbols: minUniqueSymbols,
    dueCount: dueObservations.length,
    measurementCoverage: round(measurementCoverage, 4),
    minimumMeasurementCoverage: minMeasurementCoverage,
    maxMeasurementDelayMinutes,
    componentCorrelations,
    componentMultipliers,
    reason: !enoughSamples
      ? "WAITING_FOR_MINIMUM_OUTCOME_SAMPLES"
      : !coveragePass
        ? "OUTCOME_MEASUREMENT_COVERAGE_TOO_LOW"
        : !diversityPass
          ? "OUTCOME_SYMBOL_DIVERSITY_TOO_LOW"
          : validation.reason,
  };
}
