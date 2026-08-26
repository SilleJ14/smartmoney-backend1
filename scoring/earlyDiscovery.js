const clamp = (value) => Math.max(0, Math.min(100, Number(value) || 0));

const average = (values = []) => values.length > 0
  ? values.reduce((sum, value) => sum + Number(value || 0), 0) / values.length
  : 0;

function firstPositive(...values) {
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return 0;
}

function normalizeBarTimestamp(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  const parsed = Number.isFinite(numeric)
    ? numeric < 10_000_000_000 ? numeric * 1000 : numeric
    : Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function median(values = []) {
  const sorted = values.filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const midpoint = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[midpoint - 1] + sorted[midpoint]) / 2
    : sorted[midpoint];
}

export function normalizeDiscoveryBars(
  bars = [],
  { excludeIncomplete = false, now = Date.now() } = {}
) {
  const normalized = (Array.isArray(bars) ? bars : [])
    .map((bar, sourceIndex) => {
      const rawOpen = bar?.o ?? bar?.open;
      const rawHigh = bar?.h ?? bar?.high;
      const rawLow = bar?.l ?? bar?.low;
      const rawClose = bar?.c ?? bar?.close;
      const rawVolume = bar?.v ?? bar?.volume;
      const open = Number(rawOpen);
      const high = Number(rawHigh);
      const low = Number(rawLow);
      const close = Number(rawClose);
      const volume = Number(rawVolume);
      const time = bar?.t ?? bar?.timestamp ?? bar?.time ?? bar?.d ?? null;
      return {
        open,
        high,
        low,
        close,
        volume,
        time,
        timestampMs: normalizeBarTimestamp(time),
        sourceIndex,
      };
    })
    .filter((bar) => (
      Number.isFinite(bar.open) && bar.open > 0 &&
      Number.isFinite(bar.high) && bar.high > 0 &&
      Number.isFinite(bar.low) && bar.low > 0 &&
      Number.isFinite(bar.close) && bar.close > 0 &&
      Number.isFinite(bar.volume) && bar.volume >= 0 &&
      bar.high >= Math.max(bar.open, bar.close) &&
      bar.low <= Math.min(bar.open, bar.close) &&
      bar.high >= bar.low
    ));

  normalized.sort((left, right) => {
    if (left.timestampMs !== null && right.timestampMs !== null) {
      return left.timestampMs - right.timestampMs;
    }
    return left.sourceIndex - right.sourceIndex;
  });

  const deduplicated = [];
  const timestampIndexes = new Map();
  for (const bar of normalized) {
    if (bar.timestampMs === null) {
      deduplicated.push(bar);
      continue;
    }
    const existingIndex = timestampIndexes.get(bar.timestampMs);
    if (existingIndex === undefined) {
      timestampIndexes.set(bar.timestampMs, deduplicated.length);
      deduplicated.push(bar);
    } else {
      // Prefer the last provider observation for a duplicated interval.
      deduplicated[existingIndex] = bar;
    }
  }

  const timestamped = deduplicated.filter((bar) => bar.timestampMs !== null);
  const inferredIntervalMs = median(timestamped.slice(1).map(
    (bar, index) => bar.timestampMs - timestamped[index].timestampMs
  ));
  const completed = excludeIncomplete && inferredIntervalMs
    ? deduplicated.filter((bar) => (
      bar.timestampMs === null || bar.timestampMs + inferredIntervalMs <= Number(now)
    ))
    : deduplicated;

  return completed.map(({ sourceIndex: _sourceIndex, ...bar }) => bar);
}

const EXTENSION_THRESHOLDS = Object.freeze({
  stock: Object.freeze({ 1: 6, 3: 12, 5: 18, 20: 35 }),
  crypto: Object.freeze({ 1: 8, 3: 15, 5: 25, 20: 50 }),
});

export function calculateMultiHorizonExtension({
  bars = [],
  currentPrice,
  assetClass = "stock",
  excludeIncomplete = false,
  now = Date.now(),
} = {}) {
  const clean = normalizeDiscoveryBars(bars, { excludeIncomplete, now });
  const current = firstPositive(currentPrice, clean.at(-1)?.close);
  const thresholds = EXTENSION_THRESHOLDS[assetClass] || EXTENSION_THRESHOLDS.stock;
  const horizons = [1, 3, 5, 20].map((days) => {
    const referenceIndex = clean.length - 1 - days;
    const reference = referenceIndex >= 0 ? clean[referenceIndex]?.close : 0;
    const available = current > 0 && reference > 0;
    const changePercent = available ? ((current - reference) / reference) * 100 : null;
    const threshold = thresholds[days];
    const positiveExcess = available ? Math.max(0, changePercent - threshold) : 0;
    const severity = available
      ? clamp((positiveExcess / Math.max(1, threshold)) * 100)
      : 0;
    return {
      days,
      available,
      changePercent: changePercent === null ? null : Number(changePercent.toFixed(3)),
      thresholdPercent: threshold,
      severity: Number(severity.toFixed(2)),
      extended: severity >= 35,
    };
  });
  const availableHorizons = horizons.filter((item) => item.available);
  const maximumSeverity = availableHorizons.reduce(
    (maximum, item) => Math.max(maximum, item.severity),
    0
  );
  // The four returns are correlated views of the same price path. Use only the
  // strongest extension reading instead of summing four penalties.
  const extensionPenalty = Math.min(45, maximumSeverity * 0.45);
  const alreadyExtended = horizons.some((item) => item.extended);
  return {
    assetClass,
    horizons,
    changes: Object.fromEntries(
      horizons.map((item) => [`day${item.days}`, item.changePercent])
    ),
    availableHorizons: availableHorizons.length,
    coverage: Number((availableHorizons.length / horizons.length).toFixed(2)),
    maximumSeverity: Number(maximumSeverity.toFixed(2)),
    extensionPenalty: Number(extensionPenalty.toFixed(2)),
    alreadyExtended,
    penaltyMethod: "MAX_CORRELATED_HORIZON_ONLY",
  };
}

function normalizedComponentScore(components = [], learning = {}) {
  const activeLearning = learning?.active === true;
  const adjusted = components.map((component) => {
    const multiplier = activeLearning
      ? Math.max(
        0.9,
        Math.min(1.1, Number(learning?.componentMultipliers?.[component.name] || 1))
      )
      : 1;
    return {
      ...component,
      configuredWeight: component.weight,
      learningMultiplier: multiplier,
      adjustedWeight: component.weight * multiplier,
    };
  });
  const configuredWeight = adjusted.reduce((sum, component) => sum + component.weight, 0);
  const availableWeight = adjusted
    .filter((component) => component.available)
    .reduce((sum, component) => sum + component.weight, 0);
  const adjustedAvailableWeight = adjusted
    .filter((component) => component.available)
    .reduce((sum, component) => sum + component.adjustedWeight, 0);
  const telemetry = adjusted.map((component) => {
    const effectiveWeight = component.available && adjustedAvailableWeight > 0
      ? component.adjustedWeight / adjustedAvailableWeight
      : 0;
    return {
      ...component,
      value: Number(clamp(component.value).toFixed(2)),
      effectiveWeight: Number(effectiveWeight.toFixed(4)),
      contribution: Number((clamp(component.value) * effectiveWeight).toFixed(2)),
    };
  });
  return {
    rawScore: Number(
      telemetry.reduce((sum, component) => sum + component.contribution, 0).toFixed(2)
    ),
    coverage: Number(
      (configuredWeight > 0 ? availableWeight / configuredWeight : 0).toFixed(2)
    ),
    components: telemetry,
    missingComponents: telemetry
      .filter((component) => !component.available)
      .map((component) => component.name),
    learningApplied: activeLearning,
    learningSampleCount: Number(learning?.sampleCount || 0),
  };
}

function calculateVolumeDryUpScore(volumeRatio, supportHolding) {
  if (!Number.isFinite(volumeRatio) || volumeRatio <= 0) return 0;
  const lifecycle = volumeRatio >= 0.45 && volumeRatio <= 0.9
    ? 88
    : volumeRatio > 0.9 && volumeRatio <= 1.15
      ? 68
      : volumeRatio > 1.15 && volumeRatio <= 1.5
        ? 55
        : volumeRatio < 0.25
          ? 48
          : volumeRatio > 2.5
            ? 25
            : 42;
  return clamp(lifecycle * 0.75 + supportHolding * 0.25);
}

function calculateAwakeningScore(intradayBars = []) {
  const bars = normalizeDiscoveryBars(intradayBars);
  if (bars.length < 5) {
    return { score: 0, available: false, volumeRatio: null, priceChangePercent: null };
  }
  const latest = bars.at(-1);
  const baseline = bars.slice(-11, -1);
  const baselineVolume = average(baseline.map((bar) => bar.volume).filter((value) => value > 0));
  const volumeRatio = baselineVolume > 0 ? latest.volume / baselineVolume : 0;
  const priorClose = bars.at(-2)?.close || latest.open;
  const priceChangePercent = priorClose > 0
    ? ((latest.close - priorClose) / priorClose) * 100
    : 0;
  const score = volumeRatio >= 1.2 && volumeRatio <= 2.5 && Math.abs(priceChangePercent) <= 2.5
    ? 85
    : volumeRatio > 1 && volumeRatio < 1.2
      ? 65
      : volumeRatio > 2.5 && volumeRatio <= 4 && Math.abs(priceChangePercent) <= 3.5
        ? 62
        : volumeRatio > 4 || Math.abs(priceChangePercent) > 5
          ? 30
          : 48;
  return {
    score,
    available: baselineVolume > 0,
    volumeRatio: Number(volumeRatio.toFixed(3)),
    priceChangePercent: Number(priceChangePercent.toFixed(3)),
  };
}

export function calculateCryptoEarlyDiscoveryScore({
  symbol = "",
  dailyBars = [],
  intradayBars = [],
  currentPrice,
  newsCatalyst = null,
  learning = null,
  now = Date.now(),
} = {}) {
  const daily = normalizeDiscoveryBars(dailyBars, { excludeIncomplete: true, now });
  const recent = daily.slice(-5);
  const baseline = daily.slice(-20, -5);
  const latest = recent.at(-1);
  const price = firstPositive(currentPrice, latest?.close);
  const dailyEvidenceAvailable = recent.length >= 5 && baseline.length >= 5 && price > 0;
  const rangePercent = (bar) => bar.close > 0
    ? ((bar.high - bar.low) / bar.close) * 100
    : 0;
  const recentRange = average(recent.map(rangePercent));
  const baselineRange = average(baseline.map(rangePercent));
  const compressionRatio = baselineRange > 0 ? recentRange / baselineRange : 1;
  const compressionScore = clamp(100 - compressionRatio * 55);
  const higherLowCount = recent.slice(1).filter(
    (bar, index) => bar.low > recent[index].low
  ).length;
  const higherLowScore = clamp(35 + higherLowCount * 16);
  const recentLow = recent.length > 0 ? Math.min(...recent.map((bar) => bar.low)) : 0;
  const recentHigh = recent.length > 0 ? Math.max(...recent.map((bar) => bar.high)) : 0;
  const supportHoldingScore = recentHigh > recentLow
    ? clamp(35 + ((price - recentLow) / (recentHigh - recentLow)) * 55)
    : 50;
  const structureScore = clamp(
    compressionScore * 0.5 + higherLowScore * 0.3 + supportHoldingScore * 0.2
  );

  const recentVolume = average(recent.map((bar) => bar.volume));
  const baselineVolume = average(baseline.map((bar) => bar.volume));
  const recentToBaselineVolume = baselineVolume > 0 ? recentVolume / baselineVolume : 0;
  const upVolume = recent
    .filter((bar) => bar.close >= bar.open)
    .reduce((sum, bar) => sum + bar.volume, 0);
  const totalVolume = recent.reduce((sum, bar) => sum + bar.volume, 0);
  const accumulationRatio = totalVolume > 0 ? upVolume / totalVolume : 0;
  const threeDayReference = daily.at(-4)?.close || 0;
  const threeDayChange = threeDayReference > 0
    ? ((price - threeDayReference) / threeDayReference) * 100
    : 0;
  const gradualAccumulation = threeDayChange >= -1 && threeDayChange <= 6;
  const accumulationScore = clamp(
    25 + accumulationRatio * 55 + (gradualAccumulation ? 15 : 0) + higherLowCount * 3
  );
  const volumeDryUpScore = calculateVolumeDryUpScore(
    recentToBaselineVolume,
    supportHoldingScore
  );
  const completedIntraday = normalizeDiscoveryBars(intradayBars, {
    excludeIncomplete: true,
    now,
  });
  const awakening = calculateAwakeningScore(completedIntraday);
  const volumeLifecycleScore = awakening.available
    ? clamp(volumeDryUpScore * 0.65 + awakening.score * 0.35)
    : volumeDryUpScore;
  const catalystAvailable = newsCatalyst?.catalystAvailable === true;
  const catalystScore = catalystAvailable ? Number(newsCatalyst.catalystScore || 0) : 0;
  const discoveryComponents = [
    { name: "structure", source: "daily_compression_higher_lows_support", value: structureScore, weight: 0.4, available: dailyEvidenceAvailable },
    { name: "accumulation", source: "up_volume_and_gradual_price_accumulation", value: accumulationScore, weight: 0.25, available: dailyEvidenceAvailable && totalVolume > 0 },
    { name: "volumeLifecycle", source: "daily_dry_up_plus_intraday_awakening", value: volumeLifecycleScore, weight: 0.2, available: dailyEvidenceAvailable && baselineVolume > 0 },
    { name: "catalystNovelty", source: newsCatalyst?.source || "crypto_news", value: catalystScore, weight: 0.15, available: catalystAvailable },
  ];
  const scored = normalizedComponentScore(discoveryComponents, learning);
  const technicalScored = normalizedComponentScore(
    discoveryComponents.filter((component) => component.name !== "catalystNovelty"),
    learning
  );
  const catalystBonus = catalystAvailable
    ? Math.max(0, Math.min(8, (clamp(catalystScore) - 50) * 0.16))
    : 0;
  const combinedRawScore = clamp(technicalScored.rawScore + catalystBonus);
  const extension = calculateMultiHorizonExtension({
    bars: daily,
    currentPrice: price,
    assetClass: "crypto",
    now,
  });
  // Missing news reduces evidence coverage, not technical discovery quality.
  // A fresh positive catalyst can add a small bounded bonus; it cannot create
  // a candidate without the underlying quiet technical setup.
  let score = clamp(combinedRawScore - extension.extensionPenalty);
  if (extension.alreadyExtended) score = Math.min(score, 55);
  const gates = [
    ...(daily.length >= 21 ? [] : ["INSUFFICIENT_COMPLETED_DAILY_HISTORY"]),
    ...(extension.coverage >= 1 ? [] : ["INCOMPLETE_MULTI_HORIZON_EXTENSION_EVIDENCE"]),
    ...(extension.alreadyExtended ? ["ALREADY_EXTENDED_MULTI_HORIZON"] : []),
    ...(newsCatalyst?.riskDetected === true ? ["NEGATIVE_NEWS_RISK"] : []),
  ];
  if (daily.length < 21 || extension.coverage < 1) score = Math.min(score, 55);
  if (newsCatalyst?.riskDetected === true) score = Math.min(score, 35);
  return {
    stage: "CRYPTO_EARLY_DISCOVERY",
    calculatedAt: new Date(now).toISOString(),
    symbol,
    score: Number(score.toFixed(2)),
    rawScore: Number(combinedRawScore.toFixed(2)),
    technicalScore: technicalScored.rawScore,
    catalystBonus: Number(catalystBonus.toFixed(2)),
    coverage: scored.coverage,
    components: scored.components,
    missingComponents: scored.missingComponents,
    learningApplied: scored.learningApplied,
    learningSampleCount: scored.learningSampleCount,
    extension,
    dataQuality: {
      suppliedDailyBars: Array.isArray(dailyBars) ? dailyBars.length : 0,
      completedValidDailyBars: daily.length,
      suppliedIntradayBars: Array.isArray(intradayBars) ? intradayBars.length : 0,
      completedValidIntradayBars: completedIntraday.length,
      fullExtensionCoverage: extension.coverage >= 1,
    },
    gates,
    features: {
      compressionRatio: Number(compressionRatio.toFixed(3)),
      compressionScore: Number(compressionScore.toFixed(2)),
      higherLowCount,
      higherLowScore: Number(higherLowScore.toFixed(2)),
      supportHoldingScore: Number(supportHoldingScore.toFixed(2)),
      accumulationRatio: Number(accumulationRatio.toFixed(3)),
      accumulationScore: Number(accumulationScore.toFixed(2)),
      recentToBaselineVolume: Number(recentToBaselineVolume.toFixed(3)),
      volumeDryUpScore: Number(volumeDryUpScore.toFixed(2)),
      earlyVolumeAwakeningScore: Number(awakening.score.toFixed(2)),
      earlyVolumeAwakeningRatio: awakening.volumeRatio,
      threeDayChange: Number(threeDayChange.toFixed(3)),
    },
    tier: score >= 82 && scored.coverage >= 0.8 && extension.coverage >= 1
      ? "ELITE_CRYPTO_PRE_MOVER"
      : score >= 70 && scored.coverage >= 0.65 && extension.coverage >= 1
        ? "STRONG_CRYPTO_PRE_MOVER"
        : score >= 58 && scored.coverage >= 0.5
          ? "DEVELOPING_CRYPTO_PRE_MOVER"
          : extension.alreadyExtended
            ? "LATE_CRYPTO_MOVE"
            : "LOW_CRYPTO_DISCOVERY",
  };
}
