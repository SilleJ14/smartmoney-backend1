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
  return String(candidate.symbol || candidate.s || candidate.T || "").trim().toUpperCase();
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

function liquidityBucket(candidate = {}) {
  const dollarVolume = Number(
    candidate.dollarVolume24h ??
    candidate.dollarVolume ??
    candidate.averageDollarVolume ??
    0
  );
  if (!Number.isFinite(dollarVolume) || dollarVolume <= 0) return "UNKNOWN";
  if (dollarVolume >= 100_000_000) return "VERY_HIGH";
  if (dollarVolume >= 10_000_000) return "HIGH";
  if (dollarVolume >= 1_000_000) return "MEDIUM";
  return "LOW";
}

function marketCapBucket(candidate = {}) {
  const marketCap = Number(candidate.marketCap ?? candidate.market_cap ?? 0);
  if (!Number.isFinite(marketCap) || marketCap <= 0) return "UNKNOWN";
  if (marketCap >= 200_000_000_000) return "MEGA";
  if (marketCap >= 10_000_000_000) return "LARGE";
  if (marketCap >= 2_000_000_000) return "MID";
  if (marketCap >= 300_000_000) return "SMALL";
  return "MICRO";
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

function roundedAverage(values = []) {
  const finiteValues = values
    .filter((value) => value !== null && value !== undefined && value !== "")
    .map(Number)
    .filter(Number.isFinite);
  if (finiteValues.length === 0) return null;
  return Number((
    finiteValues.reduce((sum, value) => sum + value, 0) /
    finiteValues.length
  ).toFixed(2));
}

function summarizeOutcomeHorizon(observations = [], horizonDays) {
  const measurements = observations
    .map((observation) => observation?.measurements?.[horizonDays])
    .filter((measurement) =>
      measurement &&
      measurement.peakReturnPercent !== null &&
      measurement.peakReturnPercent !== undefined &&
      Number.isFinite(Number(measurement.peakReturnPercent))
    );
  const breakoutHitCount = measurements.filter(
    (measurement) => measurement.breakoutHit === true
  ).length;

  return {
    horizonDays,
    measuredCount: measurements.length,
    breakoutHitCount,
    breakoutHitRatePercent: measurements.length > 0
      ? Number(((breakoutHitCount / measurements.length) * 100).toFixed(1))
      : null,
    averageCloseReturnPercent: roundedAverage(
      measurements.map((measurement) => measurement.closeReturnPercent)
    ),
    averagePeakReturnPercent: roundedAverage(
      measurements.map((measurement) => measurement.peakReturnPercent)
    ),
  };
}

function compactLearningStatus(learning = {}, fallbackAssetClass) {
  const minimumSamples = Math.max(1, Number(learning?.minimumSamples || 30));
  const sampleCount = Math.max(0, Number(learning?.sampleCount || 0));
  return {
    assetClass: learning?.assetClass || fallbackAssetClass,
    active: learning?.active === true,
    sampleCount,
    dueCount: Math.max(0, Number(learning?.dueCount || 0)),
    minimumSamples,
    measurementCoverage: Number.isFinite(Number(learning?.measurementCoverage))
      ? Number(learning.measurementCoverage)
      : 0,
    uniqueSymbolCount: Math.max(0, Number(learning?.uniqueSymbolCount || 0)),
    progressPercent: Number(
      Math.min(100, (sampleCount / minimumSamples) * 100).toFixed(1)
    ),
    reason: learning?.reason || "WAITING_FOR_MINIMUM_QUIET_CANDIDATE_SAMPLES",
  };
}

function compactDiscoveryStatus(discoveryState = {}) {
  const state = discoveryState && typeof discoveryState === "object"
    ? discoveryState
    : {};
  return {
    updatedAt: state.updatedAt || null,
    provider: state.provider || state.source || null,
    reviewedCount: Math.max(
      0,
      Number(state.universeRows || state.reviewedCount || 0)
    ),
    eligibleCount: Math.max(0, Number(state.eligibleCount || 0)),
    selectedCount: Math.max(
      0,
      Number(state.watchlistCount || state.selectedCount || 0)
    ),
  };
}

export function summarizeQuietCandidateOutcomes(
  outcomeState = {},
  {
    learning,
    stockDiscoveryState,
    cryptoDiscoveryState,
    now = Date.now(),
  } = {}
) {
  const safeState = outcomeState && typeof outcomeState === "object"
    ? outcomeState
    : {};
  const observations = Array.isArray(safeState.observations)
    ? safeState.observations
    : [];
  const outcomeLearning = learning || safeState.learning || {};
  const summarizeAsset = (assetClass) => {
    const assetObservations = observations.filter(
      (observation) => observation?.assetClass === assetClass
    );
    const measuredObservationCount = assetObservations.filter(
      (observation) => HORIZONS.some((days) =>
        observation?.measurements?.[days]?.peakReturnPercent !== null &&
        observation?.measurements?.[days]?.peakReturnPercent !== undefined &&
        Number.isFinite(
          Number(observation?.measurements?.[days]?.peakReturnPercent)
        )
      )
    ).length;
    const becameTradeCount = assetObservations.filter(
      (observation) => observation?.becameTrade === true
    ).length;
    return {
      assetClass,
      observationCount: assetObservations.length,
      measuredObservationCount,
      becameTradeCount,
      becameTradeRatePercent: assetObservations.length > 0
        ? Number(((becameTradeCount / assetObservations.length) * 100).toFixed(1))
        : null,
      horizons: Object.fromEntries(
        HORIZONS.map((days) => [
          days,
          summarizeOutcomeHorizon(assetObservations, days),
        ])
      ),
    };
  };

  return {
    version: 1,
    generatedAt: new Date(now).toISOString(),
    updatedAt: safeState.updatedAt || null,
    breakoutDefinition: {
      stockPeakReturnPercent: 8,
      cryptoPeakReturnPercent: 10,
    },
    stock: summarizeAsset("stock"),
    crypto: summarizeAsset("crypto"),
    learning: {
      stock: compactLearningStatus(outcomeLearning.stock, "stock"),
      crypto: compactLearningStatus(outcomeLearning.crypto, "crypto"),
    },
    discovery: {
      stock: compactDiscoveryStatus(stockDiscoveryState),
      crypto: compactDiscoveryStatus(cryptoDiscoveryState),
    },
  };
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
    (observation) => {
      const value = observation.measurements?.[horizonDays]?.peakReturnPercent;
      return value !== null && value !== undefined && value !== "" &&
        Number.isFinite(Number(value));
    }
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
    cryptoMeasurementMaxLagMs = 6 * 60 * 60 * 1000,
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
  const benchmarkSymbol = assetClass === "stock"
    ? [...prices.keys()].find((symbol) => symbol === "SPY")
    : [...prices.keys()].find((symbol) => ["BTC/USD", "BTCUSD", "BTC-USD"].includes(symbol));
  const momentumCandidate = (Array.isArray(priceUniverse) ? priceUniverse : [])
    .map((candidate) => ({
      symbol: symbolOf(candidate),
      price: priceOf(candidate),
      momentum: Number(candidate.percentChange ?? candidate.changePercent ?? candidate.todaysChangePerc ?? -Infinity),
    }))
    .filter((candidate) => candidate.symbol && candidate.price > 0 && Number.isFinite(candidate.momentum))
    .sort((a, b) => b.momentum - a.momentum)[0] || null;
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
    // Crypto provider highs are commonly rolling 24-hour highs and may have
    // occurred before this candidate was selected. Only observed scan prices
    // are eligible for post-selection crypto peak tracking.
    const observedPeakPrice = assetClass === "crypto"
      ? current.price
      : current.high;
    const peakPrice = Math.max(
      Number(observation.trackingPeakPrice || observation.baselinePrice),
      observedPeakPrice,
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
      const targetTimestamp = Number(observation.targetTimestamps?.[days] || 0);
      const missedTargetWindow = assetClass === "crypto"
        ? targetTimestamp > 0 && Number(now) > targetTimestamp + cryptoMeasurementMaxLagMs
        : dayKey > observation.targets[days];
      if (missedTargetWindow) {
        observation.measurements[days] = {
          status: "MISSED_TARGET_WINDOW",
          targetDay: observation.targets[days],
          measuredDay: null,
          closePrice: null,
          closeReturnPercent: null,
          peakReturnPercent: null,
          breakoutHit: null,
        };
        continue;
      }
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
      observation.benchmarkMeasurements ||= {};
      observation.benchmarkMeasurements[days] = Object.fromEntries(
        Object.entries(observation.benchmarks || {}).map(([name, benchmark]) => {
          const currentBenchmark = prices.get(benchmark.symbol);
          const baseline = Number(benchmark.baselinePrice || 0);
          return [name, currentBenchmark && baseline > 0
            ? Number((((currentBenchmark.price - baseline) / baseline) * 100).toFixed(4))
            : null];
        })
      );
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
      scoringModelVersion: candidate.scoringModelVersion ||
        (assetClass === "crypto" ? "SMARTMONEY_CRYPTO_DECISION_V3" : "SMARTMONEY_STOCK_DECISION_V3"),
      marketRegime: String(
        candidate.marketRegime || candidate.cryptoRegime || candidate.regime || "UNKNOWN"
      ).toUpperCase(),
      liquidityBucket: liquidityBucket(candidate),
      marketCapBucket: marketCapBucket(candidate),
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
      benchmarks: {
        ...(benchmarkSymbol && prices.get(benchmarkSymbol)
          ? { [assetClass === "stock" ? "SPY" : "Bitcoin"]: { symbol: benchmarkSymbol, baselinePrice: prices.get(benchmarkSymbol).price } }
          : {}),
        ...(momentumCandidate
          ? { simpleMomentum: { symbol: momentumCandidate.symbol, baselinePrice: momentumCandidate.price } }
          : {}),
      },
      benchmarkMeasurements: {},
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
