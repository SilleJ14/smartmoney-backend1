import { addUsStockMarketSessionDays } from "../utils/usMarketCalendar.js";

const HORIZONS = Object.freeze([1, 3, 5]);

const clamp = (value) => Math.max(0, Math.min(100, Number(value) || 0));

function dayKeyFromDate(value = Date.now()) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : null;
}

function addCalendarDays(dayKey, days) {
  const date = new Date(`${dayKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function targetDay(dayKey, days, assetClass) {
  if (assetClass === "stock") {
    const [year, month, day] = dayKey.split("-").map(Number);
    const next = addUsStockMarketSessionDays({ year, month, day }, days);
    return `${next.year}-${String(next.month).padStart(2, "0")}-${String(next.day).padStart(2, "0")}`;
  }
  return addCalendarDays(dayKey, days);
}

function symbolOf(candidate = {}) {
  return String(candidate.symbol || candidate.s || "").trim().toUpperCase();
}

function priceOf(candidate = {}) {
  const value = Number(
    candidate.current ?? candidate.livePrice ?? candidate.price ?? candidate.close ?? candidate.c ?? 0
  );
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function highOf(candidate = {}) {
  const value = Number(candidate.high ?? candidate.h ?? priceOf(candidate));
  return Number.isFinite(value) && value > 0 ? value : priceOf(candidate);
}

function componentScores(candidate = {}) {
  const components = candidate.discoveryScorecard?.components ||
    candidate.cryptoDiscoveryScorecard?.components ||
    candidate.components || [];
  return Object.fromEntries(
    (Array.isArray(components) ? components : [])
      .filter((component) => component?.name && component.available !== false)
      .map((component) => [component.name, Number(clamp(component.value).toFixed(2))])
  );
}

function pearson(pairs = []) {
  if (pairs.length < 2) return 0;
  const meanX = pairs.reduce((sum, pair) => sum + pair.x, 0) / pairs.length;
  const meanY = pairs.reduce((sum, pair) => sum + pair.y, 0) / pairs.length;
  let covariance = 0;
  let varianceX = 0;
  let varianceY = 0;
  for (const pair of pairs) {
    const x = pair.x - meanX;
    const y = pair.y - meanY;
    covariance += x * y;
    varianceX += x ** 2;
    varianceY += y ** 2;
  }
  const denominator = Math.sqrt(varianceX * varianceY);
  return denominator > 0 ? covariance / denominator : 0;
}

export function calculateQuietCandidateLearning(
  state = {},
  {
    assetClass,
    horizonDays = 3,
    minSamples = 30,
    minCoverage = 0.8,
    minUniqueSymbols = 10,
  } = {}
) {
  const safeState = state && typeof state === "object" ? state : {};
  const observations = (Array.isArray(safeState.observations)
    ? safeState.observations
    : []).filter(
    (observation) => observation.assetClass === assetClass
  );
  const evaluatedAt = Date.parse(safeState.updatedAt || "") || Date.now();
  const due = observations.filter(
    (observation) => observation.assetClass === "crypto"
      ? Number(observation.targetTimestamps?.[horizonDays] || 0) > 0 &&
        evaluatedAt >= Number(observation.targetTimestamps[horizonDays])
      : observation.targets?.[horizonDays] &&
        safeState.updatedDayKey >= observation.targets[horizonDays]
  );
  const measured = due.filter(
    (observation) => Number.isFinite(Number(observation.measurements?.[horizonDays]?.peakReturnPercent))
  );
  const measurementCoverage = due.length > 0 ? measured.length / due.length : 0;
  const uniqueSymbols = new Set(measured.map((observation) => observation.symbol)).size;
  const active = measured.length >= minSamples &&
    measurementCoverage >= minCoverage &&
    uniqueSymbols >= minUniqueSymbols;
  const names = [...new Set(measured.flatMap(
    (observation) => Object.keys(observation.componentScores || {})
  ))];
  const componentCorrelations = {};
  const componentMultipliers = {};
  for (const name of names) {
    const pairs = measured
      .map((observation) => ({
        x: Number(observation.componentScores?.[name]),
        y: Number(observation.measurements?.[horizonDays]?.peakReturnPercent),
      }))
      .filter((pair) => Number.isFinite(pair.x) && Number.isFinite(pair.y));
    const correlation = pairs.length >= minSamples ? pearson(pairs) : 0;
    componentCorrelations[name] = {
      sampleCount: pairs.length,
      correlation: Number(correlation.toFixed(4)),
    };
    componentMultipliers[name] = active && pairs.length >= minSamples
      ? Number(Math.max(0.9, Math.min(1.1, 1 + correlation * 0.1)).toFixed(4))
      : 1;
  }
  return {
    assetClass,
    active,
    horizonDays,
    sampleCount: measured.length,
    dueCount: due.length,
    measurementCoverage: Number(measurementCoverage.toFixed(4)),
    uniqueSymbolCount: uniqueSymbols,
    minimumSamples: minSamples,
    minimumCoverage: minCoverage,
    minimumUniqueSymbols: minUniqueSymbols,
    componentCorrelations,
    componentMultipliers,
    reason: measured.length < minSamples
      ? "WAITING_FOR_MINIMUM_QUIET_CANDIDATE_SAMPLES"
      : measurementCoverage < minCoverage
        ? "QUIET_CANDIDATE_MEASUREMENT_COVERAGE_TOO_LOW"
        : uniqueSymbols < minUniqueSymbols
          ? "QUIET_CANDIDATE_SYMBOL_DIVERSITY_TOO_LOW"
          : "BOUNDED_QUIET_DISCOVERY_LEARNING_ACTIVE",
  };
}

export function updateQuietCandidateOutcomes(
  previousState = {},
  selectedCandidates = [],
  priceUniverse = [],
  {
    assetClass,
    dayKey = dayKeyFromDate(),
    now = Date.now(),
    maxObservations = 600,
    maxObservationsPerAsset = 300,
    tradedSymbols = [],
  } = {}
) {
  const safePreviousState = previousState && typeof previousState === "object"
    ? previousState
    : {};
  const safeMaxObservations = Math.max(
    50,
    Math.min(600, Number(maxObservations || 600))
  );
  const safeMaxPerAsset = Math.max(
    50,
    Math.min(
      safeMaxObservations,
      Number(maxObservationsPerAsset || 300)
    )
  );
  const traded = new Set(
    (Array.isArray(tradedSymbols) ? tradedSymbols : [])
      .map((value) => symbolOf(typeof value === "string" ? { symbol: value } : value))
      .filter(Boolean)
  );
  const prices = new Map(
    (Array.isArray(priceUniverse) ? priceUniverse : [])
      .map((candidate) => [symbolOf(candidate), {
        price: priceOf(candidate),
        high: highOf(candidate),
      }])
      .filter(([symbol, value]) => symbol && value.price > 0)
  );
  const observations = (Array.isArray(safePreviousState.observations)
    ? safePreviousState.observations
    : []).map((observation) => ({
      ...observation,
      targets: { ...(observation.targets || {}) },
      measurements: { ...(observation.measurements || {}) },
    }));

  for (const observation of observations) {
    if (observation.assetClass !== assetClass) continue;
    if (
      traded.has(observation.symbol) &&
      observation.alreadyTradedAtSelection !== true
    ) {
      observation.becameTrade = true;
      observation.becameTradeAt ||= Number(now);
    }
    const current = prices.get(observation.symbol);
    if (!current) continue;
    const peakPrice = Math.max(
      Number(observation.trackingPeakPrice || observation.baselinePrice),
      current.high,
      current.price
    );
    observation.trackingPeakPrice = Number(peakPrice.toFixed(8));
    observation.lastTrackedDay = dayKey;
    for (const days of HORIZONS) {
      if (
        observation.measurements[days] ||
        !observation.targets?.[days] ||
        (
          assetClass === "crypto"
            ? Number(now) < Number(observation.targetTimestamps?.[days] || Infinity)
            : dayKey < observation.targets[days]
        )
      ) continue;
      const closeReturnPercent = ((current.price - observation.baselinePrice) /
        observation.baselinePrice) * 100;
      const peakReturnPercent = ((peakPrice - observation.baselinePrice) /
        observation.baselinePrice) * 100;
      observation.measurements[days] = {
        targetDay: observation.targets[days],
        measuredDay: dayKey,
        closePrice: Number(current.price.toFixed(8)),
        closeReturnPercent: Number(closeReturnPercent.toFixed(4)),
        peakReturnPercent: Number(peakReturnPercent.toFixed(4)),
        breakoutHit: peakReturnPercent >= (assetClass === "crypto" ? 10 : 8),
      };
    }
  }

  const existing = new Set(observations.map((observation) => observation.id));
  for (const candidate of Array.isArray(selectedCandidates) ? selectedCandidates : []) {
    const symbol = symbolOf(candidate);
    const price = priceOf(candidate);
    const id = `${assetClass}:${symbol}:${dayKey}`;
    if (!symbol || price <= 0 || existing.has(id)) continue;
    const discoveryScore = Number(
      candidate.discoveryScore ?? candidate.cryptoDiscoveryScore ??
      candidate.discoveryScorecard?.score ?? candidate.cryptoDiscoveryScorecard?.score ??
      candidate.preMoveScore ?? 0
    );
    observations.push({
      id,
      assetClass,
      symbol,
      observedDay: dayKey,
      observedAt: Number(now),
      baselinePrice: Number(price.toFixed(8)),
      // Start future-outcome tracking at the observation price. The current
      // bar's earlier high happened before selection and must not leak into a
      // 1/3/5-day result.
      trackingPeakPrice: Number(price.toFixed(8)),
      discoveryScore: Number(clamp(discoveryScore).toFixed(2)),
      discoveryTier: candidate.discoveryTier || candidate.cryptoDiscoveryTier || candidate.tier || null,
      componentScores: componentScores(candidate),
      extensionProfile: candidate.extension || candidate.extensionProfile ||
        candidate.cryptoDiscoveryScorecard?.extension || null,
      newsCatalyst: candidate.newsCatalyst || candidate.catalystRanking || null,
      selectedQuietCandidate: true,
      alreadyTradedAtSelection: traded.has(symbol),
      becameTrade: false,
      becameTradeAt: null,
      targets: Object.fromEntries(
        HORIZONS.map((days) => [days, targetDay(dayKey, days, assetClass)])
      ),
      targetTimestamps: assetClass === "crypto"
        ? Object.fromEntries(
          HORIZONS.map((days) => [days, Number(now) + days * 24 * 60 * 60 * 1000])
        )
        : {},
      measurements: {},
    });
    existing.add(id);
  }
  const bounded = ["stock", "crypto"]
    .flatMap((className) => observations
      .filter((observation) => observation.assetClass === className)
      .sort((a, b) => Number(b.observedAt || 0) - Number(a.observedAt || 0))
      .slice(0, safeMaxPerAsset))
    .sort((a, b) => Number(b.observedAt || 0) - Number(a.observedAt || 0))
    .slice(0, safeMaxObservations);
  const nextState = {
    version: 1,
    updatedAt: new Date(now).toISOString(),
    updatedDayKey: dayKey,
    maxObservations: safeMaxObservations,
    maxObservationsPerAsset: safeMaxPerAsset,
    observationCount: bounded.length,
    observations: bounded,
  };
  nextState.learning = {
    stock: calculateQuietCandidateLearning(nextState, { assetClass: "stock" }),
    crypto: calculateQuietCandidateLearning(nextState, { assetClass: "crypto" }),
  };
  return nextState;
}
