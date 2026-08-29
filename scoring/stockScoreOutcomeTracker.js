import {
  addUsStockMarketSessionDays,
  isUsStockMarketSessionDayKey,
} from "../utils/usMarketCalendar.js";

const ET_TIME_ZONE = "America/New_York";
const DEFAULT_MAX_OBSERVATIONS = 500;
const DEFAULT_MAX_NEW_PER_CYCLE = 25;
const HORIZONS = Object.freeze([
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
  const value = Number(
    signal.masterFinalScore ??
    signal.finalAutonomousDecisionScore ??
    signal.stockDecisionScore ??
    signal.score ??
    0
  );
  return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
}

function resolveScoreBand(signal, score) {
  if (signal.finalStockExecutionGate?.approved === true) return "AUTO";
  if (
    signal.qualifiedCandidate === true ||
    (
      score >= 72 &&
      signal.entryQualityScorecard?.approved === true &&
      Number(signal.entryQualityScorecard?.coverage || 0) >= 0.8
    )
  ) return "QUALIFIED";
  if (signal.watchlistEligible === true || score >= 60) return "WATCH";
  return "RESEARCH";
}

function round(value, digits = 4) {
  const factor = 10 ** digits;
  return Math.round(Number(value || 0) * factor) / factor;
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
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(0, Number(maxNewPerCycle || 0)));

  for (const { signal, symbol, price, score } of newCandidates) {
    observations.push({
      id: `${symbol}:${observedDay}`,
      symbol,
      observedDay,
      observedAt: now,
      baselinePrice: round(price, 6),
      scoreBand: resolveScoreBand(signal, score),
      finalScore: round(score, 2),
      discoveryScore: round(signal.discoveryScore || signal.discoveryScorecard?.score || 0, 2),
      entryScore: round(signal.entryQualityScore || signal.entryQualityScorecard?.score || 0, 2),
      continuationScore: round(signal.multiDayContinuationScore || signal.continuationScorecard?.score || 0, 2),
      componentScores: decisionComponentScores(signal),
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
    return measurement &&
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
  const active = enoughSamples && coveragePass && diversityPass;
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
      ? round(Math.max(0.95, Math.min(1.05, 1 + correlation * 0.05)), 4)
      : 1;
  }

  return {
    version: 1,
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
          : "BOUNDED_OUTCOME_LEARNING_ACTIVE",
  };
}
