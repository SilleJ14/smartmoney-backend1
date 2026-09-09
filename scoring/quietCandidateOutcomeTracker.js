import { addUsStockMarketSessionDays } from "../utils/usMarketCalendar.js";

const HORIZONS = Object.freeze([1, 3, 5]);
// Construct ICU formatters once, not two or three times for every price in
// every durable observation page. Keep the evaluated time local to each update.
const etDayFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' });
const etHourFormatter = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' });

export function normalizeOutcomeObservation(observation) {
  const next = { ...observation, measurements: { ...(observation.measurements || {}) },
    legacyMeasurements: { ...(observation.legacyMeasurements || {}) } };
  for (const days of HORIZONS) {
    const value = next.measurements[days];
    if (value?.evidenceVerified && value.measurementPolicyVersion !== 3) {
      next.legacyMeasurements[days] = { ...value, evidenceVerified: false, status: 'LEGACY_MEASUREMENT_UNVERIFIED' };
      delete next.measurements[days];
    }
  }
  if (next.peakPolicyVersion !== 3) next.trackingPeakPrice = next.baselinePrice;
  next.peakPolicyVersion = 3;
  const benchmarkName = next.assetClass === 'stock' ? 'SPY' : 'Bitcoin';
  next.benchmarks = { [benchmarkName]: { symbol: next.assetClass === 'stock' ? 'SPY' : 'BTC/USD', baselinePrice: null, baselineStatus: 'MISSING_BASELINE_EVIDENCE' },
    simpleMomentum: { symbol: null, baselinePrice: null, baselineStatus: 'MISSING_BASELINE_EVIDENCE' }, ...(next.benchmarks || {}) };
  return next;
}

function observationEvidence(candidate, assetClass, dayKey, now, stockClock) {
  if (assetClass === "stock") {
    const providerTime = candidate.t == null ? NaN : new Date(candidate.t).getTime();
    const day = candidate.evidenceDay || candidate.d || candidate.date ||
      (Number.isFinite(providerTime) && providerTime <= now + 5000
        ? etDayFormatter.format(new Date(providerTime)) : null);
    const { etDay, etHour } = stockClock;
    const dailyBar = Boolean(candidate.evidenceDay || candidate.d || candidate.date) &&
      Number(candidate.c ?? candidate.close) > 0;
    const completedClose = dailyBar && (day < etDay || day === etDay && etHour >= 16);
    return day === dayKey && day <= etDay
      ? { valid: true, evidenceDay: day, completedClose,
        closePrice: completedClose ? Number(candidate.c ?? candidate.close) : null } : { valid: false };
  }
  const raw = candidate.liveQuoteUpdatedAt || candidate.quoteUpdatedAt || candidate.priceUpdatedAt || candidate.quoteFetchedAt;
  const time = typeof raw === "number" ? raw : Date.parse(raw);
  return Number.isFinite(time) && time <= now + 5000 && now - time <= 60000
    ? { valid: true, evidenceTimestamp: time } : { valid: false };
}

export function getQuietFollowupSymbols(state = {}, { now = Date.now(), limit = 120 } = {}) {
  const due = (Array.isArray(state?.observations) ? state.observations : []).filter((o) => o?.assetClass === "crypto" &&
    HORIZONS.some((days) => (!o.measurements?.[days] ||
      (o.measurements[days].status !== "MISSED_TARGET_WINDOW" &&
        Object.keys(o.benchmarks || {}).some((name) => o.benchmarks[name].baselinePrice > 0 && o.benchmarkMeasurements?.[days]?.[name] == null))) && o.targetTimestamps?.[days] <= now &&
      now - o.targetTimestamps[days] <= 6 * 3600000));
  return [...new Set(due.flatMap((o) => [o.symbol,
    ...Object.values(o.benchmarks || {}).filter(b => b.baselinePrice > 0).map((benchmark) => benchmark.symbol)]))].filter(Boolean).slice(0, limit);
}

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
  const verifiedObservations = observations.filter((o) => o.evidenceVersion === 2);
  const measurements = observations
    .filter((observation) => observation.evidenceVersion === 2)
    .map((observation) => observation?.measurements?.[horizonDays])
    .filter((measurement) =>
      measurement?.evidenceVerified === true && measurement.measurementPolicyVersion === 3 &&
      measurement.peakReturnPercent !== null &&
      measurement.peakReturnPercent !== undefined &&
      Number.isFinite(Number(measurement.peakReturnPercent))
    );
  const breakoutHitCount = measurements.filter(
    (measurement) => measurement.breakoutHit === true
  ).length;

  return {
    horizonDays,
    denominatorScope: "RETAINED_VERIFIED_BASELINES_NOT_FULL_DISCOVERY_POPULATION",
    trackedCount: verifiedObservations.length,
    missedCount: verifiedObservations.filter((o) => o.measurements?.[horizonDays]?.status === "MISSED_TARGET_WINDOW").length,
    pendingCount: verifiedObservations.filter((o) => !o.measurements?.[horizonDays]).length,
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
      (observation) => observation.evidenceVersion === 2 && HORIZONS.some((days) =>
        observation?.measurements?.[days]?.evidenceVerified === true && observation.measurements[days].measurementPolicyVersion === 3 &&
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
    trackingPolicy: safeState.trackingPolicy || "LEGACY_SELECTED_CANDIDATES",
    dailySampleLimit: safeState.dailySampleLimit ?? null,
    untrackedDiscoveriesThisUpdate: safeState.untrackedDiscoveriesThisUpdate ?? null,
    samplingByAsset: safeState.samplingByAsset || {},
    discoveryPopulationThisUpdate: safeState.discoveryPopulationThisUpdate ?? null,
    excludedByRetentionThisUpdate: safeState.excludedByRetentionThisUpdate ?? null,
    legacyUnverifiedObservationCount: observations.filter((o) => o.evidenceVersion !== 2).length,
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
      if (observation.evidenceVersion !== 2 || observation.measurements?.[horizonDays]?.evidenceVerified !== true || observation.measurements[horizonDays].measurementPolicyVersion !== 3) return false;
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
    tradeEvents = [],
    cryptoMeasurementMaxLagMs = 6 * 60 * 60 * 1000,
    fullPopulationPage = false,
  } = {}
) {
  const safePreviousState = previousState && typeof previousState === "object"
    ? previousState
    : {};
  const stockClock = { etDay: etDayFormatter.format(new Date(now)), etHour: Number(etHourFormatter.format(new Date(now))) };
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
  const fillsBySymbol = new Map();
  for (const event of tradeEvents) {
    const symbol = symbolOf(event).replace(/[/-]/g, '');
    const filledAt = Number(event.filledAt);
    if (!symbol || !Number.isFinite(filledAt) || filledAt <= 0 || filledAt > now) continue;
    if (!fillsBySymbol.has(symbol)) fillsBySymbol.set(symbol, []);
    fillsBySymbol.get(symbol).push(filledAt);
  }
  for (const times of fillsBySymbol.values()) times.sort((a, b) => a - b);
  const prices = new Map(
    (Array.isArray(priceUniverse) ? priceUniverse : [])
      .map((candidate) => [symbolOf(candidate), {
        price: priceOf(candidate),
        high: highOf(candidate),
        ...observationEvidence(candidate, assetClass, dayKey, Number(now), stockClock),
      }])
      .filter(([symbol, value]) => symbol && value.price > 0 && value.valid)
  );
  const benchmarkSymbol = assetClass === "stock"
    ? [...prices.keys()].find((symbol) => symbol === "SPY")
    : [...prices.keys()].find((symbol) => ["BTC/USD", "BTCUSD", "BTC-USD"].includes(symbol));
  const momentumCandidate = (Array.isArray(priceUniverse) ? priceUniverse : [])
    .map((candidate) => ({
      symbol: symbolOf(candidate),
      price: priceOf(candidate),
      momentum: Number(candidate.percentChange ?? candidate.changePercent ?? candidate.todaysChangePerc ??
        (Number(candidate.o) > 0 ? ((priceOf(candidate) - Number(candidate.o)) / Number(candidate.o)) * 100 : -Infinity)),
    }))
    .filter((candidate) => prices.has(candidate.symbol) && candidate.price > 0 && Number.isFinite(candidate.momentum))
    .sort((a, b) => b.momentum - a.momentum)[0] || null;
  const observations = (Array.isArray(safePreviousState.observations)
    ? safePreviousState.observations
    : []).map(normalizeOutcomeObservation).map((observation) => ({
      ...observation,
      targets: { ...(observation.targets || {}) },
      measurements: { ...(observation.measurements || {}) },
      benchmarkMeasurements: Object.fromEntries(Object.entries(observation.benchmarkMeasurements || {})
        .map(([days, values]) => [days, { ...values }])),
    }));

  for (const observation of observations) {
    if (observation.assetClass !== assetClass) continue;
    if (dayKey < observation.observedDay) continue;
    const confirmedTradeAt = fillsBySymbol.get(observation.symbol.replace(/[/-]/g, ''))
      ?.find(filledAt => filledAt >= observation.observedAt);
    // Benchmarks have independent completion state: a measured candidate must
    // not prevent a late (but still in-window) benchmark from being recorded.
    for (const days of HORIZONS) {
      const measurement = observation.measurements[days];
      if (!measurement || measurement.status === "MISSED_TARGET_WINDOW") continue;
      const target = Number(observation.targetTimestamps?.[days] || Infinity);
      const inWindow = assetClass === "crypto"
        ? Number(now) >= target && Number(now) <= target + cryptoMeasurementMaxLagMs
        : dayKey === observation.targets?.[days];
      if (!inWindow) continue;
      for (const [name, benchmark] of Object.entries(observation.benchmarks || {})) {
        if (observation.benchmarkMeasurements[days]?.[name] != null) continue;
        const value = prices.get(benchmark.symbol);
        const baseline = Number(benchmark.baselinePrice || 0);
        if (!value || baseline <= 0 || (assetClass === 'stock' ? !value.completedClose : value.evidenceTimestamp < target)) continue;
        observation.benchmarkMeasurements[days] ||= {};
        const benchmarkClose = assetClass === 'stock' ? value.closePrice : value.price;
        observation.benchmarkMeasurements[days][name] = Number((((benchmarkClose - baseline) / baseline) * 100).toFixed(4));
      }
    }
    if (
      (traded.has(observation.symbol) || confirmedTradeAt) &&
      observation.alreadyTradedAtSelection !== true
    ) {
      observation.becameTrade = true;
      observation.becameTradeAt ||= Number(confirmedTradeAt || now);
    }
    const current = prices.get(observation.symbol);
    if (!current) {
      observation.lastEvidenceStatus = "MISSING_OR_STALE_TARGET_PRICE";
      for (const days of HORIZONS) {
        const missed = assetClass === "crypto"
          ? Number(now) > Number(observation.targetTimestamps?.[days] || Infinity) + cryptoMeasurementMaxLagMs
          : dayKey > observation.targets?.[days];
        if (!observation.measurements[days] && missed) observation.measurements[days] = {
          status: "MISSED_TARGET_WINDOW", closeReturnPercent: null, peakReturnPercent: null, evidenceVerified: false,
        };
      }
      continue;
    }
    // Crypto provider highs are commonly rolling 24-hour highs and may have
    // occurred before this candidate was selected. Only observed scan prices
    // are eligible for post-selection crypto peak tracking.
    const observedPeakPrice = assetClass === "crypto" || dayKey <= observation.observedDay
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
      if (assetClass === "crypto" && current.evidenceTimestamp < targetTimestamp) continue;
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
      // The target-day date is not evidence of a closing price. Live/premarket
      // observations still update observed peaks, but cannot settle a horizon.
      if (assetClass === 'stock' && !current.completedClose) continue;
      const closingPrice = assetClass === 'stock' ? current.closePrice : current.price;
      const closeReturnPercent = ((closingPrice - observation.baselinePrice) /
        observation.baselinePrice) * 100;
      const peakReturnPercent = ((peakPrice - observation.baselinePrice) /
        observation.baselinePrice) * 100;
      observation.measurements[days] = {
        measurementPolicyVersion: 3,
        priceBasis: assetClass === 'stock' ? 'COMPLETED_SESSION_CLOSE' : 'TARGET_WINDOW_OBSERVED_PRICE',
        peakBasis: 'POST_SELECTION_OBSERVED_PEAK_NOT_CONTINUOUS_TICK_COVERAGE',
        evidenceVerified: observation.evidenceVersion === 2,
        evidenceTimestamp: current.evidenceTimestamp || null,
        evidenceDay: current.evidenceDay || null,
        targetDay: observation.targets[days],
        measuredDay: dayKey,
        closePrice: Number(closingPrice.toFixed(8)),
        closeReturnPercent: Number(closeReturnPercent.toFixed(4)),
        peakReturnPercent: Number(peakReturnPercent.toFixed(4)),
        breakoutHit: peakReturnPercent >= (assetClass === "crypto" ? 10 : 8),
      };
      observation.benchmarkMeasurements ||= {};
      observation.benchmarkMeasurements[days] = Object.fromEntries(
        Object.entries(observation.benchmarks || {}).map(([name, benchmark]) => {
          const currentBenchmark = prices.get(benchmark.symbol);
          const baseline = Number(benchmark.baselinePrice || 0);
          return [name, currentBenchmark && baseline > 0 &&
            (assetClass === 'stock' ? currentBenchmark.completedClose : currentBenchmark.evidenceTimestamp >= targetTimestamp)
            ? Number(((((assetClass === 'stock' ? currentBenchmark.closePrice : currentBenchmark.price) - baseline) / baseline) * 100).toFixed(4))
            : null];
        })
      );
    }
  }

  const existing = new Set(observations.map((observation) => observation.id));
  // Freeze a bounded daily sample so frequent scans cannot evict observations
  // before day 3/5. Stable hashing avoids selecting only the highest D scores.
  const dailySampleLimit = fullPopulationPage ? Infinity : Math.min(40, Math.floor(safeMaxPerAsset / 6));
  const dailySlots = Math.max(0, dailySampleLimit - observations.filter((o) => o.assetClass === assetClass && o.observedDay === dayKey).length);
  const sampleHash = (candidate) => {
    let hash = 2166136261;
    for (const char of `${dayKey}:${symbolOf(candidate)}`) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
    return hash >>> 0;
  };
  const registrationCandidates = (Array.isArray(selectedCandidates) ? selectedCandidates : [])
    .filter((candidate) => !existing.has(`${assetClass}:${symbolOf(candidate)}:${dayKey}`))
    .filter((candidate) => prices.has(symbolOf(candidate)) || observationEvidence(candidate, assetClass, dayKey, Number(now), stockClock).valid)
    .sort((a, b) => sampleHash(a) - sampleHash(b)).slice(0, dailySlots);
  for (const candidate of registrationCandidates) {
    const symbol = symbolOf(candidate);
    const ownEvidence = observationEvidence(candidate, assetClass, dayKey, Number(now), stockClock);
    const evidence = prices.get(symbol) || (ownEvidence.valid ? { ...ownEvidence, price: priceOf(candidate) } : null);
    const price = evidence?.price || 0;
    const id = `${assetClass}:${symbol}:${dayKey}`;
    if (!symbol || price <= 0 || existing.has(id)) continue;
    const discoveryScore = Number(
      candidate.discoveryScore ?? candidate.cryptoDiscoveryScore ??
      candidate.discoveryScorecard?.score ?? candidate.cryptoDiscoveryScorecard?.score ??
      candidate.preMoveScore ?? 0
    );
    observations.push({
      evidenceVersion: 2,
      id,
      assetClass,
      symbol,
      observedDay: dayKey,
      observedAt: Number(now),
      baselinePrice: Number(price.toFixed(8)),
      baselineEvidenceTimestamp: evidence.evidenceTimestamp || null,
      baselineEvidenceDay: evidence.evidenceDay || null,
      // Start future-outcome tracking at the observation price. The current
      // bar's earlier high happened before selection and must not leak into a
      // 1/3/5-day result.
      trackingPeakPrice: Number(price.toFixed(8)),
      peakPolicyVersion: 3,
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
        [assetClass === 'stock' ? 'SPY' : 'Bitcoin']: {
          symbol: benchmarkSymbol || (assetClass === 'stock' ? 'SPY' : 'BTC/USD'),
          baselinePrice: benchmarkSymbol ? prices.get(benchmarkSymbol).price : null,
          baselineStatus: benchmarkSymbol ? 'VERIFIED_AT_SELECTION' : 'MISSING_BASELINE_EVIDENCE',
        },
        simpleMomentum: { symbol: momentumCandidate?.symbol || null, baselinePrice: momentumCandidate?.price || null,
          baselineStatus: momentumCandidate ? 'VERIFIED_AT_SELECTION' : 'MISSING_BASELINE_EVIDENCE' },
      },
      benchmarkMeasurements: {},
    });
    existing.add(id);
  }
  const bounded = fullPopulationPage ? observations : ["stock", "crypto"]
    .flatMap((className) => {
      const rows = observations.filter((o) => o.assetClass === className);
      const completed = rows.filter((o) => o.measurements?.[3]?.evidenceVerified === true)
        .sort((a, b) => b.observedAt - a.observedAt).slice(0, Math.floor(safeMaxPerAsset / 3));
      const reserved = new Set(completed.map((o) => o.id));
      const pending = (o) => o.evidenceVersion === 2 && !o.measurements?.[5] &&
        (o.assetClass === "stock" ? o.targets?.[5] >= stockClock.etDay : Number(o.targetTimestamps?.[5]) + 6 * 3600000 >= Number(now));
      const remaining = rows.filter((o) => !reserved.has(o.id)).sort((a, b) =>
        Number(pending(b)) - Number(pending(a)) || a.observedAt - b.observedAt);
      return [...completed, ...remaining].slice(0, safeMaxPerAsset);
    })
    .sort((a, b) => Number(b.observedAt || 0) - Number(a.observedAt || 0))
    .slice(0, safeMaxObservations);
  const nextState = {
    version: 2,
    measurementPolicyVersion: 3,
    updatedAt: new Date(now).toISOString(),
    updatedDayKey: dayKey,
    maxObservations: safeMaxObservations,
    maxObservationsPerAsset: safeMaxPerAsset,
    observationCount: bounded.length,
    trackingPolicy: fullPopulationPage ? "DURABLE_FULL_POPULATION_PAGE" : "BOUNDED_DISCOVERY_SAMPLE_NOT_FULL_POPULATION",
    dailySampleLimit,
    untrackedDiscoveriesThisUpdate: selectedCandidates.filter((candidate) =>
      !bounded.some((o) => o.id === `${assetClass}:${symbolOf(candidate)}:${dayKey}`)).length,
    discoveryPopulationThisUpdate: selectedCandidates.length,
    excludedByRetentionThisUpdate: Math.max(0, observations.length - bounded.length),
    missingBaselineEvidenceThisUpdate: selectedCandidates.filter((c) => !prices.has(symbolOf(c))).length,
    observations: bounded,
  };
  nextState.samplingByAsset = {
    ...(safePreviousState.samplingByAsset || {}),
    [assetClass]: {
      updatedAt: nextState.updatedAt, dayKey, dailySampleLimit,
      discoveredThisUpdate: selectedCandidates.length,
      eligibleBaselineThisUpdate: selectedCandidates.filter((c) => prices.has(symbolOf(c))).length,
      sampledThisUpdate: selectedCandidates.filter((c) => bounded.some((o) =>
        o.id === `${assetClass}:${symbolOf(c)}:${dayKey}`)).length,
      untrackedThisUpdate: nextState.untrackedDiscoveriesThisUpdate,
      missingBaselineEvidenceThisUpdate: nextState.missingBaselineEvidenceThisUpdate,
      retained: bounded.filter((o) => o.assetClass === assetClass).length,
    },
  };
  nextState.learning = {
    stock: calculateQuietCandidateLearning(nextState, { assetClass: "stock" }),
    crypto: calculateQuietCandidateLearning(nextState, { assetClass: "crypto" }),
  };
  return nextState;
}
