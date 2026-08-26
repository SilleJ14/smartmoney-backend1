const clampScore = (value) => Math.max(0, Math.min(100, Number(value) || 0));

export const CRYPTO_MIN_WINDOW_DOLLAR_VOLUME = 25_000;
export const CRYPTO_PROBE_WINDOW_DOLLAR_VOLUME = 10_000;
export const CRYPTO_MIN_REPORTED_24H_DOLLAR_VOLUME = 1_000_000;
export const CRYPTO_PROBE_REPORTED_24H_DOLLAR_VOLUME = 250_000;
export const CRYPTO_MAX_ENTRY_SPREAD_PERCENT = 0.85;
export const MAX_CRYPTO_CONTINUATION_SESSIONS = 8;
export const MAX_CRYPTO_CONTINUATION_SYMBOLS = 100;
export const CRYPTO_CONTINUATION_MAX_AGE_DAYS = 14;

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
    if (value === null || value === undefined || value === "") continue;
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return undefined;
}

function positiveFiniteNumberOrZero(...values) {
  return positiveFiniteNumber(...values) ?? finiteNumber(...values);
}

export function getCryptoBaseAsset(symbol = "") {
  const normalized = String(symbol || "")
    .toUpperCase()
    .replace(/^X:/, "")
    .trim();
  if (!normalized) return "";
  const delimitedBase = normalized.split(/[\/-]/)[0];
  if (delimitedBase !== normalized) return delimitedBase;
  for (const quoteAsset of ["USDT", "USDC", "USD"]) {
    if (normalized.endsWith(quoteAsset) && normalized.length > quoteAsset.length) {
      return normalized.slice(0, -quoteAsset.length);
    }
  }
  return normalized;
}

function isValidUtcDayKey(value) {
  const dayKey = String(value || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) return false;
  const parsed = new Date(`${dayKey}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === dayKey;
}

export function getUniqueCryptoSessionDays(values = []) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map((value) => String(value || "")).filter(isValidUtcDayKey))]
    .sort();
}

function sanitizeContinuationSessions(sessions = [], maxSessions = MAX_CRYPTO_CONTINUATION_SESSIONS) {
  const byDay = new Map();
  for (const session of Array.isArray(sessions) ? sessions : []) {
    const dayKey = String(session?.dayKey || "");
    const close = positiveFiniteNumber(session?.close);
    if (!isValidUtcDayKey(dayKey) || close === undefined) continue;
    const open = positiveFiniteNumber(session?.open, close) || close;
    const high = Math.max(open, close, positiveFiniteNumber(session?.high) || 0);
    const low = Math.min(open, close, positiveFiniteNumber(session?.low) || close);
    byDay.set(dayKey, {
      dayKey,
      open: Number(open.toFixed(8)),
      high: Number(high.toFixed(8)),
      low: Number(low.toFixed(8)),
      close: Number(close.toFixed(8)),
      completed: session?.completed === true,
    });
  }
  return [...byDay.values()]
    .sort((a, b) => a.dayKey.localeCompare(b.dayKey))
    .slice(-Math.max(2, Number(maxSessions) || MAX_CRYPTO_CONTINUATION_SESSIONS));
}

export function calculateCryptoMultiSessionContinuation(entry = {}) {
  const sessions = sanitizeContinuationSessions(entry.continuationSessions);
  const completedSessions = sessions.filter((session) => session.completed === true);
  const seenDays = getUniqueCryptoSessionDays(
    completedSessions.map((session) => session.dayKey)
  );
  const uniqueCompleted = seenDays
    .map((dayKey) => completedSessions.find((session) => session.dayKey === dayKey))
    .filter(Boolean);
  const scoringSessions = uniqueCompleted.slice(-5);
  const observedSessions = uniqueCompleted.length;
  const coverage = Math.min(1, Math.max(0, (observedSessions - 1) / 3));

  if (observedSessions < 2) {
    return {
      score: 50,
      available: false,
      coverage: 0,
      tier: "INSUFFICIENT_MULTI_SESSION_EVIDENCE",
      source: "persisted_crypto_daily_sessions",
      seenDays,
      observedSessions,
      cumulativeReturnPercent: 0,
      positiveSessionRatio: 0,
      maxDrawdownPercent: 0,
    };
  }

  const closes = scoringSessions.map((session) => session.close);
  const returns = closes.slice(1).map((close, index) => (
    ((close - closes[index]) / closes[index]) * 100
  ));
  const positiveSessionRatio = returns.filter((value) => value > 0).length /
    Math.max(1, returns.length);
  const cumulativeReturnPercent = ((closes[closes.length - 1] - closes[0]) / closes[0]) * 100;
  let peak = closes[0];
  let maxDrawdownPercent = 0;
  for (const close of closes) {
    peak = Math.max(peak, close);
    maxDrawdownPercent = Math.max(
      maxDrawdownPercent,
      peak > 0 ? ((peak - close) / peak) * 100 : 0
    );
  }

  // This family intentionally uses only completed daily price observations.
  // Scanner momentum, current entry quality, volume and phase-51 scores are not
  // reused, which keeps continuation independent from discovery and execution.
  const persistenceScore = clampScore(
    50 +
    Math.max(-12, Math.min(12, cumulativeReturnPercent)) * 3 +
    (positiveSessionRatio - 0.5) * 30
  );
  const supportScore = clampScore(70 - Math.min(20, maxDrawdownPercent) * 8);
  const unscaledScore = persistenceScore * 0.6 + supportScore * 0.4;
  const score = clampScore(50 + (unscaledScore - 50) * coverage);
  const tier = score >= 75
    ? "STRONG_MULTI_SESSION_CONTINUATION"
    : score >= 62
      ? "DEVELOPING_MULTI_SESSION_CONTINUATION"
      : score >= 48
        ? "NEUTRAL_MULTI_SESSION_CONTINUATION"
        : "WEAK_MULTI_SESSION_CONTINUATION";

  return {
    score: Number(score.toFixed(2)),
    available: true,
    coverage: Number(coverage.toFixed(2)),
    tier,
    source: "persisted_crypto_daily_sessions",
    seenDays,
    observedSessions,
    cumulativeReturnPercent: Number(cumulativeReturnPercent.toFixed(3)),
    positiveSessionRatio: Number(positiveSessionRatio.toFixed(3)),
    maxDrawdownPercent: Number(maxDrawdownPercent.toFixed(3)),
    persistenceScore: Number(persistenceScore.toFixed(2)),
    supportScore: Number(supportScore.toFixed(2)),
  };
}

export function updateCryptoContinuationMemoryEntry(
  previous = {},
  signal = {},
  { now = new Date(), maxSessions = MAX_CRYPTO_CONTINUATION_SESSIONS } = {}
) {
  const timestamp = now instanceof Date ? now : new Date(now);
  const dayKey = Number.isFinite(timestamp.getTime())
    ? timestamp.toISOString().slice(0, 10)
    : "";
  const price = positiveFiniteNumber(
    signal.current,
    signal.livePrice,
    signal.price,
    signal.close
  );
  let sessions = sanitizeContinuationSessions(previous.continuationSessions, maxSessions);
  if (!isValidUtcDayKey(dayKey) || price === undefined) {
    const continuation = calculateCryptoMultiSessionContinuation({
      continuationSessions: sessions,
    });
    return { ...previous, continuationSessions: sessions, ...continuation };
  }

  const explicitOpen = positiveFiniteNumber(signal.open, signal.o);
  const explicitHigh = positiveFiniteNumber(signal.high, signal.h);
  const explicitLow = positiveFiniteNumber(signal.low, signal.l);
  const existingIndex = sessions.findIndex((session) => session.dayKey === dayKey);
  if (existingIndex >= 0) {
    const existing = sessions[existingIndex];
    sessions[existingIndex] = {
      dayKey,
      open: existing.open,
      high: Number(Math.max(existing.high, explicitHigh || 0, price).toFixed(8)),
      low: Number(Math.min(existing.low, explicitLow || price, price).toFixed(8)),
      close: Number(price.toFixed(8)),
      completed: false,
    };
  } else {
    sessions = sessions.map((session) => ({ ...session, completed: true }));
    sessions.push({
      dayKey,
      open: Number((explicitOpen || price).toFixed(8)),
      high: Number(Math.max(explicitHigh || 0, price).toFixed(8)),
      low: Number(Math.min(explicitLow || price, price).toFixed(8)),
      close: Number(price.toFixed(8)),
      completed: false,
    });
  }
  sessions = sanitizeContinuationSessions(sessions, maxSessions);
  const continuation = calculateCryptoMultiSessionContinuation({
    continuationSessions: sessions,
  });
  return {
    continuationSessions: sessions,
    ...continuation,
    lastSeenAt: timestamp.toISOString(),
  };
}

export function pruneCryptoContinuationMemory(
  memory = {},
  {
    now = new Date(),
    maxSymbols = MAX_CRYPTO_CONTINUATION_SYMBOLS,
    maxAgeDays = CRYPTO_CONTINUATION_MAX_AGE_DAYS,
  } = {}
) {
  const timestamp = now instanceof Date ? now : new Date(now);
  const nowMs = Number.isFinite(timestamp.getTime()) ? timestamp.getTime() : Date.now();
  const maxAgeMs = Math.max(1, Number(maxAgeDays) || CRYPTO_CONTINUATION_MAX_AGE_DAYS) * 86400000;
  return Object.fromEntries(
    Object.entries(memory || {})
      .filter(([, entry]) => {
        const lastSeenMs = new Date(entry?.lastSeenAt || 0).getTime();
        return Number.isFinite(lastSeenMs) && nowMs - lastSeenMs <= maxAgeMs;
      })
      .sort(([, a], [, b]) => (
        new Date(b?.lastSeenAt || 0).getTime() - new Date(a?.lastSeenAt || 0).getTime()
      ))
      .slice(0, Math.max(1, Number(maxSymbols) || MAX_CRYPTO_CONTINUATION_SYMBOLS))
  );
}

export function getCryptoLiquidityThresholds(source = "aggregated_bar_window") {
  return source === "reported_24h"
    ? {
      minimum: CRYPTO_MIN_REPORTED_24H_DOLLAR_VOLUME,
      probeMinimum: CRYPTO_PROBE_REPORTED_24H_DOLLAR_VOLUME,
    }
    : {
      minimum: CRYPTO_MIN_WINDOW_DOLLAR_VOLUME,
      probeMinimum: CRYPTO_PROBE_WINDOW_DOLLAR_VOLUME,
    };
}

export function resolveCryptoLiquidityEvidence(marketData = {}) {
  const realism = marketData.cryptoRealism || {};
  const hintedSource = String(
    marketData.liquiditySource || realism.liquiditySource || ""
  );
  // These aliases describe the same reported measurement. The first explicit
  // finite value wins, including zero, so a stale later alias cannot turn a
  // reported outage/zero into passing liquidity.
  const reported24hDollarVolume = finiteNumber(
    marketData.dollarVolume24h,
    marketData.quoteVolume24h,
    marketData.volumeUsd24h,
    hintedSource === "reported_24h" ? marketData.dollarVolume : undefined,
    realism.liquiditySource === "reported_24h" ? realism.dollarVolume : undefined
  );
  const windowDollarVolume = finiteNumber(
    marketData.windowDollarVolume,
    hintedSource === "aggregated_bar_window" ? marketData.dollarVolume : undefined,
    realism.liquiditySource === "aggregated_bar_window" ? realism.dollarVolume : undefined
  );
  const source = reported24hDollarVolume !== undefined
    ? "reported_24h"
    : windowDollarVolume !== undefined
      ? "aggregated_bar_window"
      : "missing";
  const dollarVolume = Math.max(
    0,
    source === "reported_24h"
      ? reported24hDollarVolume || 0
      : windowDollarVolume || 0
  );
  const thresholds = getCryptoLiquidityThresholds(source);
  return {
    source,
    dollarVolume: Number(dollarVolume.toFixed(2)),
    minimum: thresholds.minimum,
    probeMinimum: thresholds.probeMinimum,
    available: dollarVolume > 0,
    pass: dollarVolume >= thresholds.minimum,
    probePass: dollarVolume >= thresholds.probeMinimum,
  };
}

export function calculateCryptoEntryQualityFromEvidence({
  spreadAvailable = false,
  spreadPercent = null,
  liquidityEvidence = {},
} = {}) {
  const cleanSpread = finiteNumber(spreadPercent);
  const spreadMeasured =
    spreadAvailable === true &&
    cleanSpread !== undefined &&
    cleanSpread >= 0;
  const liquidityAvailable = liquidityEvidence.available === true;
  const liquidityMinimum = Math.max(1, Number(liquidityEvidence.minimum || 0));
  const dollarVolume = Math.max(0, Number(liquidityEvidence.dollarVolume || 0));
  const spreadQualityScore = spreadMeasured
    ? clampScore(
      100 -
      Math.min(
        100,
        (cleanSpread / CRYPTO_MAX_ENTRY_SPREAD_PERCENT) * 80
      )
    )
    : null;
  const liquidityRatio = liquidityAvailable
    ? dollarVolume / liquidityMinimum
    : 0;
  const liquidityQualityScore = liquidityAvailable
    ? clampScore(20 + Math.min(80, liquidityRatio * 60))
    : null;
  const available = spreadMeasured && liquidityAvailable;
  const score = available
    ? clampScore(
      spreadQualityScore * 0.6 +
      liquidityQualityScore * 0.4
    )
    : 0;
  return {
    score: Number(score.toFixed(2)),
    available,
    spreadQualityScore:
      spreadQualityScore === null ? null : Number(spreadQualityScore.toFixed(2)),
    liquidityQualityScore:
      liquidityQualityScore === null
        ? null
        : Number(liquidityQualityScore.toFixed(2)),
    spreadPass:
      spreadMeasured && cleanSpread <= CRYPTO_MAX_ENTRY_SPREAD_PERCENT,
    liquidityPass: liquidityEvidence.pass === true,
  };
}

export function scoreSparseCryptoMarket(quote = {}, barsFound = 0) {
  const current = positiveFiniteNumber(
    quote.current,
    quote.price,
    quote.last,
    quote.close
  ) || 0;
  if (current <= 0) return 0;

  const changePercent = finiteNumber(
    quote.changePercent,
    quote.percentChange,
    quote.change_percent,
    quote.dp
  ) || 0;
  const boundedMove = Math.max(-5, Math.min(5, changePercent));
  const coverageAdjustment = Number(barsFound || 0) > 0 ? 2 : 0;

  // Sparse history is unknown evidence, not a 0-100 score equal to percentage
  // change. Keep the score neutral and let the entry data gate fail closed.
  return Number(clampScore(50 + boundedMove * 6 + coverageAdjustment).toFixed(2));
}

export function calculateCryptoLiquidityFromBars(
  bars = [],
  currentPrice = 0,
  marketData = {}
) {
  const cleanBars = Array.isArray(bars)
    ? bars
      .map((bar) => {
        const close = positiveFiniteNumber(bar.c, bar.close, bar.price) || 0;
        const volume = positiveFiniteNumberOrZero(
          bar.v,
          bar.volume,
          bar.volume_crypto,
          bar.baseVolume
        ) || 0;
        const quoteVolume = positiveFiniteNumberOrZero(
          bar.volume_usd,
          bar.quoteVolume,
          bar.dollarVolume
        );
        return { close, volume, quoteVolume };
      })
      .filter((bar) => bar.close > 0)
    : [];

  const latestBar = cleanBars[cleanBars.length - 1] || {};
  const effectivePrice = positiveFiniteNumber(currentPrice, latestBar.close) || 0;
  const baseVolumes = cleanBars.map((bar) => bar.volume).filter((value) => value > 0);
  const averageVolume = baseVolumes.length
    ? baseVolumes.reduce((sum, value) => sum + value, 0) / baseVolumes.length
    : 0;
  const latestVolume = Number(latestBar.volume || 0);
  const maxVolume = baseVolumes.length ? Math.max(...baseVolumes) : 0;
  const effectiveVolume = latestVolume || averageVolume || maxVolume;
  const volumeSpikeRatio = averageVolume > 0 && latestVolume > 0
    ? latestVolume / averageVolume
    : averageVolume > 0
      ? 1
      : 0;

  const windowDollarVolume = cleanBars.reduce((sum, bar) => {
    const barDollarVolume = Number.isFinite(bar.quoteVolume)
      ? Number(bar.quoteVolume)
      : bar.volume * bar.close;
    return sum + Math.max(0, barDollarVolume);
  }, 0);
  const latestBarDollarVolume = Number.isFinite(latestBar.quoteVolume)
    ? Number(latestBar.quoteVolume)
    : latestVolume * Number(latestBar.close || effectivePrice || 0);
  const averageBarDollarVolume = cleanBars.length > 0
    ? windowDollarVolume / cleanBars.length
    : 0;
  const explicit24hDollarVolume = finiteNumber(
    marketData.dollarVolume24h,
    marketData.quoteVolume24h,
    marketData.volumeUsd24h,
    marketData.volume_24h_usd
  );
  const baseVolume24h = finiteNumber(
    marketData.volume24h,
    marketData.volume_24h
  );
  const estimated24hDollarVolume = baseVolume24h !== undefined && effectivePrice > 0
    ? baseVolume24h * effectivePrice
    : undefined;
  const dollarVolume24h = finiteNumber(
    explicit24hDollarVolume,
    estimated24hDollarVolume
  );
  const dollarVolume = dollarVolume24h !== undefined
    ? Math.max(0, dollarVolume24h)
    : windowDollarVolume;
  const liquiditySource = dollarVolume24h !== undefined
    ? "reported_24h"
    : windowDollarVolume > 0
      ? "aggregated_bar_window"
      : "missing";
  const liquidityThresholds = getCryptoLiquidityThresholds(liquiditySource);
  const volumeConfidenceScore = clampScore(
    20 +
    (cleanBars.length >= 20 ? 20 : cleanBars.length >= 10 ? 12 : cleanBars.length >= 3 ? 6 : 0) +
    (baseVolumes.length >= 10 ? 20 : baseVolumes.length >= 3 ? 12 : baseVolumes.length > 0 ? 5 : 0) +
    (volumeSpikeRatio >= 2 ? 15 : volumeSpikeRatio >= 1 ? 10 : volumeSpikeRatio > 0 ? 5 : 0) +
    (dollarVolume >= liquidityThresholds.minimum
      ? 20
      : dollarVolume >= liquidityThresholds.probeMinimum
        ? 10
        : 0)
  );

  return {
    volume: Number(latestVolume.toFixed(2)),
    averageVolume: Number(averageVolume.toFixed(2)),
    effectiveVolume: Number(effectiveVolume.toFixed(2)),
    maxVolume: Number(maxVolume.toFixed(2)),
    nonZeroVolumeBars: baseVolumes.length,
    volumeSpikeRatio: Number(volumeSpikeRatio.toFixed(3)),
    latestBarDollarVolume: Number(Math.max(0, latestBarDollarVolume || 0).toFixed(2)),
    averageBarDollarVolume: Number(averageBarDollarVolume.toFixed(2)),
    windowDollarVolume: Number(windowDollarVolume.toFixed(2)),
    dollarVolume24h: dollarVolume24h === undefined
      ? null
      : Number(Math.max(0, dollarVolume24h).toFixed(2)),
    dollarVolume: Number(dollarVolume.toFixed(2)),
    liquiditySource,
    liquidityMinimumDollarVolume: liquidityThresholds.minimum,
    liquidityProbeMinimumDollarVolume: liquidityThresholds.probeMinimum,
    liquidityPass: dollarVolume >= liquidityThresholds.minimum,
    liquidityProbePass: dollarVolume >= liquidityThresholds.probeMinimum,
    volumeConfidenceScore: Number(volumeConfidenceScore.toFixed(2)),
  };
}

export function calculateCryptoSignalRealism(signal = {}) {
  const symbol = String(signal.symbol || "").toUpperCase();
  const rawScore = finiteNumber(
    signal.cryptoDiscoveryScorecard?.score,
    signal.rawCryptoScore,
    signal.scannerScore,
    signal.score
  ) || 0;
  const barsFound = Math.max(0, finiteNumber(signal.barsFound) || 0);
  const bid = finiteNumber(signal.bid);
  const ask = finiteNumber(signal.ask);
  const price = positiveFiniteNumber(
    signal.current,
    signal.price,
    signal.livePrice
  ) || 0;
  const providedSpreadPercent = finiteNumber(signal.spreadPercent);
  const spreadReferencePrice =
    bid !== undefined && ask !== undefined
      ? (bid + ask) / 2
      : price;
  const quoteSpreadAvailable =
    bid !== undefined && ask !== undefined && bid > 0 && ask >= bid && spreadReferencePrice > 0;
  const spreadAvailable = quoteSpreadAvailable || (
    signal.spreadAvailable === true &&
    providedSpreadPercent !== undefined &&
    providedSpreadPercent >= 0
  );
  const spreadPercent = !spreadAvailable
    ? undefined
    : quoteSpreadAvailable
      ? ((ask - bid) / spreadReferencePrice) * 100
      : providedSpreadPercent;
  const liquidityEvidence = resolveCryptoLiquidityEvidence(signal);
  const liquiditySource = liquidityEvidence.source;
  const dollarVolume = liquidityEvidence.dollarVolume;
  const liquidityThresholds = {
    minimum: liquidityEvidence.minimum,
    probeMinimum: liquidityEvidence.probeMinimum,
  };
  const entryQuality = calculateCryptoEntryQualityFromEvidence({
    spreadAvailable,
    spreadPercent,
    liquidityEvidence,
  });
  const percentChange = finiteNumber(
    signal.percent_change_24h,
    signal.changePercent,
    signal.percentChange
  ) || 0;
  const statisticalScore = finiteNumber(
    signal.statisticalScore,
    signal.statisticalEdgeScore,
    signal.statisticalEdge?.statisticalEdgeScore,
    signal.statisticalEdge?.statisticalScore
  );
  const baseAsset = getCryptoBaseAsset(symbol);
  const isMajorCrypto = new Set(["BTC", "ETH", "SOL"]).has(baseAsset);
  const quietMarket = Math.abs(percentChange) <= 0.35;

  const dataCoveragePenalty = barsFound >= 10
    ? 0
    : barsFound >= 3
      ? 4
      : barsFound > 0
        ? 8
        : 12;
  const spreadPenalty = !spreadAvailable
    ? 0
    : spreadPercent >= 0.75
      ? 18
      : spreadPercent >= 0.35
        ? 8
        : 0;
  const liquidityPenalty = dollarVolume <= 0
    ? 10
    : dollarVolume < liquidityThresholds.probeMinimum
      ? 10
      : dollarVolume < liquidityThresholds.minimum
        ? 5
        : 0;
  // Spread and liquidity both describe the same execution-quality family.
  // Taking the larger risk prevents correlated evidence from being charged twice.
  const executionQualityPenalty = Math.max(spreadPenalty, liquidityPenalty);
  const speculativePenalty = !isMajorCrypto && price > 0 && price < 0.01 ? 6 : 0;
  const penaltyComponents = [
    { family: "dataCoverage", points: dataCoveragePenalty, available: barsFound > 0 },
    {
      family: "executionQuality",
      points: executionQualityPenalty,
      available: spreadAvailable || dollarVolume > 0,
      evidence: { spreadPenalty, liquidityPenalty },
    },
    { family: "speculativeRisk", points: speculativePenalty, available: price > 0 },
  ];
  const cryptoRiskPenalty = Math.min(
    30,
    penaltyComponents.reduce((sum, component) => sum + component.points, 0)
  );
  const missingComponents = [
    ...(barsFound > 0 ? [] : ["barHistory"]),
    ...(spreadAvailable ? [] : ["liveSpread"]),
    ...(dollarVolume > 0 ? [] : ["liquidity"]),
    ...(statisticalScore === undefined ? ["statisticalEdge"] : []),
  ];
  const entryBlockReasons = [
    ...(barsFound >= 10 ? [] : ["INSUFFICIENT_BAR_HISTORY"]),
    ...(spreadAvailable ? [] : ["MISSING_LIVE_SPREAD"]),
    ...(spreadAvailable && spreadPercent > CRYPTO_MAX_ENTRY_SPREAD_PERCENT
      ? ["SPREAD_TOO_WIDE"]
      : []),
    ...(dollarVolume >= liquidityThresholds.minimum
      ? []
      : [liquiditySource === "reported_24h"
        ? "INSUFFICIENT_24H_LIQUIDITY"
        : "INSUFFICIENT_WINDOW_LIQUIDITY"]),
  ];
  const realismScore = clampScore(rawScore - cryptoRiskPenalty);

  return {
    realismScore: Number(realismScore.toFixed(2)),
    entryQualityScore: entryQuality.score,
    entryQuality,
    rawScore: Number(rawScore.toFixed(2)),
    cryptoRiskPenalty: Number(cryptoRiskPenalty.toFixed(2)),
    penaltyComponents,
    missingComponents,
    entryBlockReasons,
    coverage: Number(((4 - missingComponents.length) / 4).toFixed(2)),
    spreadAvailable,
    spreadPass:
      spreadAvailable && spreadPercent <= CRYPTO_MAX_ENTRY_SPREAD_PERCENT,
    spreadPercent: spreadPercent === undefined ? null : Number(spreadPercent.toFixed(4)),
    dollarVolume: Number(dollarVolume.toFixed(2)),
    liquiditySource,
    liquidityMinimumDollarVolume: liquidityThresholds.minimum,
    liquidityProbeMinimumDollarVolume: liquidityThresholds.probeMinimum,
    barsFound,
    quietMarket,
    quietMarketPenalty: 0,
    missingStatisticalPenalty: 0,
    weakCryptoLiquidity: dollarVolume > 0 && dollarVolume < liquidityThresholds.minimum,
    missingCryptoLiquidity: dollarVolume <= 0,
    liquidityPass: dollarVolume >= liquidityThresholds.minimum,
    memeOrUltraSpeculative: speculativePenalty > 0,
    cryptoRealismReason: entryBlockReasons.length > 0
      ? "DISPLAY_SCORE_VALID_ENTRY_DATA_INCOMPLETE"
      : "COMPLETE_CRYPTO_EVIDENCE",
  };
}
