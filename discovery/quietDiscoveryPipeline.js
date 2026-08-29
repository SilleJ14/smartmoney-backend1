import { calculateMultiHorizonExtension } from "../scoring/earlyDiscovery.js";

const clamp = (value) => Math.max(0, Math.min(100, Number(value) || 0));
const avg = (values) => values.length ? values.reduce((sum, value) => sum + Number(value || 0), 0) / values.length : 0;

export const DEFAULT_DISCOVERY_BUDGETS = Object.freeze({
  maxUniverse: 5000,
  batchSize: 200,
  deepCandidates: 150,
  watchlistSize: 30,
  liveSymbols: 15,
  historyDays: 60,
  maxCurrentMovePercent: 3,
  minPrice: 1,
  minAverageDollarVolume: 500000,
  maxWorkingMemoryMb: 96,
});

function normalizeQuietHistory(history = []) {
  const bySession = new Map();
  (Array.isArray(history) ? history : []).forEach((item, index) => {
    const symbol = String(item?.s || item?.T || item?.symbol || "").toUpperCase();
    const dayKey = String(item?.d || item?.date || "").slice(0, 10);
    const open = Number(item?.o ?? item?.open);
    const high = Number(item?.h ?? item?.high);
    const low = Number(item?.l ?? item?.low);
    const close = Number(item?.c ?? item?.close);
    const volume = Number(item?.v ?? item?.volume ?? 0);
    const valid =
      symbol &&
      open > 0 &&
      high > 0 &&
      low > 0 &&
      close > 0 &&
      volume >= 0 &&
      high >= Math.max(open, low, close) &&
      low <= Math.min(open, high, close);
    if (!valid) return;
    const key = dayKey ? `${symbol}:${dayKey}` : `${symbol}:index:${index}`;
    bySession.set(key, {
      s: symbol,
      d: dayKey || null,
      o: open,
      h: high,
      l: low,
      c: close,
      v: volume,
      _order: index,
    });
  });
  return [...bySession.values()]
    .sort((a, b) => {
      if (a.d && b.d && a.d !== b.d) return a.d.localeCompare(b.d);
      return a._order - b._order;
    })
    .map(({ _order, ...row }) => row);
}

export function compactGroupedRows(results = [], dateKey, maxUniverse = 5000) {
  const bySymbol = new Map();
  for (const item of (Array.isArray(results) ? results : []).slice(0, maxUniverse)) {
    const symbol = String(item?.T || item?.symbol || "").toUpperCase();
    const row = {
      s: symbol,
      d: dateKey,
      o: Number(item?.o ?? item?.open),
      h: Number(item?.h ?? item?.high),
      l: Number(item?.l ?? item?.low),
      c: Number(item?.c ?? item?.close),
      v: Number(item?.v ?? item?.volume ?? 0),
    };
    if (
      !row.s ||
      !(row.o > 0) ||
      !(row.h > 0) ||
      !(row.l > 0) ||
      !(row.c > 0) ||
      row.v < 0 ||
      row.h < Math.max(row.o, row.l, row.c) ||
      row.l > Math.min(row.o, row.h, row.c)
    ) continue;
    bySymbol.set(row.s, row);
  }
  return [...bySymbol.values()];
}

export function calculateQuietPreMoveFeatures(history = [], { learning = null } = {}) {
  history = normalizeQuietHistory(history);
  if (history.length < 10) return null;
  const recent = history.slice(-5);
  const baseline = history.slice(-20, -5);
  const latest = history.at(-1);
  const prior = history.at(-2);
  const ranges = (rows) => rows.map((row) => row.c > 0 ? ((row.h - row.l) / row.c) * 100 : 0);
  const recentRange = avg(ranges(recent));
  const baselineRange = avg(ranges(baseline));
  const compressionRatio = baselineRange > 0 ? recentRange / baselineRange : 1;
  const compressionScore = clamp(100 - compressionRatio * 65);
  const recentVolume = avg(recent.map((row) => row.v));
  const baselineVolume = avg(baseline.map((row) => row.v));
  const volumeTrendRatio = baselineVolume > 0 ? recentVolume / baselineVolume : 0;
  const upVolume = recent.filter((row) => row.c >= row.o).reduce((sum, row) => sum + row.v, 0);
  const totalVolume = recent.reduce((sum, row) => sum + row.v, 0);
  const accumulationRatio = totalVolume > 0 ? upVolume / totalVolume : 0;
  const accumulationScore = clamp(20 + accumulationRatio * 70 + Math.min(20, Math.max(0, volumeTrendRatio - 1) * 25));
  const higherLowCount = recent.slice(1).filter((row, index) => row.l > recent[index].l).length;
  const structureScore = clamp(30 + higherLowCount * 15 + (latest.c >= avg(recent.map((row) => row.c)) ? 15 : 0));
  const dayChangePercent = prior.c > 0 ? ((latest.c - prior.c) / prior.c) * 100 : 0;
  const twentyDayChange = history.at(-Math.min(20, history.length))?.c > 0 ? ((latest.c - history.at(-Math.min(20, history.length)).c) / history.at(-Math.min(20, history.length)).c) * 100 : 0;
  const quietScore = clamp(100 - Math.abs(dayChangePercent) * 22);
  const liquidityScore = clamp(Math.log10(Math.max(1, latest.c * avg(history.slice(-20).map((row) => row.v)))) * 12);
  const supportHoldingScore = clamp(
    35 + (latest.c >= avg(recent.map((row) => row.c)) ? 30 : 0) + higherLowCount * 8
  );
  const volumeDryUpScore = volumeTrendRatio >= 0.45 && volumeTrendRatio <= 0.9
    ? 88
    : volumeTrendRatio > 0.9 && volumeTrendRatio <= 1.15
      ? 65
      : volumeTrendRatio > 2.5
        ? 25
        : volumeTrendRatio > 0
          ? 48
          : 0;
  const structureFamilyScore = clamp(
    compressionScore * 0.5 + structureScore * 0.3 + supportHoldingScore * 0.2
  );
  const baseComponents = [
    { name: "structure", source: "compression_higher_lows_support", value: structureFamilyScore, weight: 0.45, available: true },
    { name: "accumulation", source: "up_volume_accumulation", value: accumulationScore, weight: 0.3, available: totalVolume > 0 },
    { name: "volumeLifecycle", source: "volume_dry_up", value: volumeDryUpScore, weight: 0.15, available: baselineVolume > 0 },
    { name: "liquidity", source: "average_dollar_volume", value: liquidityScore, weight: 0.1, available: latest.c > 0 },
  ];
  const activeLearning = learning?.active === true;
  const adjustedComponents = baseComponents.map((component) => {
    const learningMultiplier = activeLearning
      ? Math.max(0.9, Math.min(1.1, Number(learning?.componentMultipliers?.[component.name] || 1)))
      : 1;
    return {
      ...component,
      learningMultiplier,
      adjustedWeight: component.weight * learningMultiplier,
    };
  });
  const availableAdjustedWeight = adjustedComponents
    .filter((component) => component.available)
    .reduce((sum, component) => sum + component.adjustedWeight, 0);
  const components = adjustedComponents.map((component) => {
    const effectiveWeight = component.available && availableAdjustedWeight > 0
      ? component.adjustedWeight / availableAdjustedWeight
      : 0;
    return {
      ...component,
      effectiveWeight: Number(effectiveWeight.toFixed(4)),
      contribution: Number((component.value * effectiveWeight).toFixed(2)),
    };
  });
  const rawPreMoveScore = clamp(
    components.reduce((sum, component) => sum + component.contribution, 0)
  );
  const extension = calculateMultiHorizonExtension({
    bars: history,
    currentPrice: latest.c,
    assetClass: "stock",
  });
  let preMoveScore = clamp(rawPreMoveScore - extension.extensionPenalty);
  if (extension.alreadyExtended) preMoveScore = Math.min(preMoveScore, 55);
  const fullExtensionEvidence = history.length >= 21 && extension.coverage >= 1;
  if (!fullExtensionEvidence) preMoveScore = Math.min(preMoveScore, 55);
  const extensionGates = [
    ...(history.length >= 21 ? [] : ["INSUFFICIENT_COMPLETED_DAILY_HISTORY"]),
    ...(extension.coverage >= 1 ? [] : ["INCOMPLETE_MULTI_HORIZON_EXTENSION_EVIDENCE"]),
    ...(extension.alreadyExtended ? ["ALREADY_EXTENDED_MULTI_HORIZON"] : []),
  ];
  return {
    symbol: latest.s,
    scoringModelVersion: "SMARTMONEY_STOCK_DECISION_V3",
    candidateSource: "EARLY_DISCOVERY",
    price: latest.c,
    current: latest.c,
    high: latest.h,
    preMoveScore: Number(preMoveScore.toFixed(2)),
    rawPreMoveScore: Number(rawPreMoveScore.toFixed(2)),
    discoveryScore: Number(preMoveScore.toFixed(2)),
    discoveryTier: extension.alreadyExtended
      ? "LATE_MOVE_NOT_DISCOVERY"
      : !fullExtensionEvidence
        ? "INSUFFICIENT_EXTENSION_EVIDENCE"
      : preMoveScore >= 82
        ? "ELITE_DISCOVERY"
        : preMoveScore >= 70
          ? "STRONG_DISCOVERY"
          : preMoveScore >= 58
            ? "DEVELOPING_DISCOVERY"
            : "LOW_DISCOVERY",
    discoveryScorecard: {
      stage: "BOUNDED_STOCK_QUIET_DISCOVERY",
      candidateSource: "EARLY_DISCOVERY",
      score: Number(preMoveScore.toFixed(2)),
      rawScore: Number(rawPreMoveScore.toFixed(2)),
      coverage: Number((baseComponents.filter((component) => component.available).reduce((sum, component) => sum + component.weight, 0)).toFixed(2)),
      components,
      missingComponents: baseComponents.filter((component) => !component.available).map((component) => component.name),
      gates: extensionGates,
      extension,
      canonicalExtensionEvidencePass: fullExtensionEvidence,
      dataQuality: {
        completedValidDailyBars: history.length,
        fullExtensionCoverage: fullExtensionEvidence,
      },
      learningApplied: activeLearning,
      learningSampleCount: Number(learning?.sampleCount || 0),
    },
    components,
    compressionScore: Number(compressionScore.toFixed(2)),
    accumulationScore: Number(accumulationScore.toFixed(2)),
    structureScore: Number(structureScore.toFixed(2)),
    structureFamilyScore: Number(structureFamilyScore.toFixed(2)),
    supportHoldingScore: Number(supportHoldingScore.toFixed(2)),
    volumeDryUpScore: Number(volumeDryUpScore.toFixed(2)),
    quietScore: Number(quietScore.toFixed(2)),
    liquidityScore: Number(liquidityScore.toFixed(2)),
    extension,
    extensionAdjusted: true,
    dayChangePercent: Number(dayChangePercent.toFixed(2)),
    twentyDayChange: Number(twentyDayChange.toFixed(2)),
    averageDollarVolume: Number((latest.c * avg(history.slice(-20).map((row) => row.v))).toFixed(2)),
    historyDays: history.length,
  };
}

export async function runBoundedQuietDiscovery({ groupedResults = [], dateKey, featureStore, budgets = {}, downloadedBytes = 0, learning = null, now = () => Date.now() } = {}) {
  const config = { ...DEFAULT_DISCOVERY_BUDGETS, ...budgets };
  const startedAt = now();
  const startingHeapBytes = process.memoryUsage().heapUsed;
  const compactRows = compactGroupedRows(groupedResults, dateKey, config.maxUniverse);
  const write = featureStore.writeDaily(dateKey, compactRows);
  const read = await featureStore.readRecentHistories({ days: config.historyDays, maxSymbols: config.maxUniverse });
  const stageA = [];
  let memoryBudgetExceeded = false;
  const histories = [...read.histories.values()];
  for (let index = 0; index < histories.length; index += config.batchSize) {
    for (const history of histories.slice(index, index + config.batchSize)) {
      if (history.at(-1)?.d !== dateKey) continue;
      const features = calculateQuietPreMoveFeatures(history, { learning });
      if (!features) continue;
      if (Math.abs(features.dayChangePercent) > config.maxCurrentMovePercent) continue;
      if (history.at(-1).c < config.minPrice || features.averageDollarVolume < config.minAverageDollarVolume) continue;
      stageA.push(features);
    }
    if (process.memoryUsage().heapUsed - startingHeapBytes > config.maxWorkingMemoryMb * 1024 * 1024) {
      memoryBudgetExceeded = true;
      break;
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
  stageA.sort((a, b) => b.preMoveScore - a.preMoveScore);
  const deepCandidates = stageA.slice(0, config.deepCandidates);
  const watchlist = deepCandidates.slice(0, config.watchlistSize);
  return {
    phase: "BOUNDED_QUIET_DISCOVERY",
    updatedAt: new Date().toISOString(),
    dateKey,
    universeRows: compactRows.length,
    eligibleCount: stageA.length,
    deepCandidateCount: deepCandidates.length,
    watchlistCount: watchlist.length,
    liveSymbols: watchlist.slice(0, config.liveSymbols).map((item) => item.symbol),
    watchlist,
    budgets: config,
    resourceUsage: { downloadedBytes, bytesWritten: write.bytesWritten, rowsRead: read.rowsRead, filesRead: read.filesRead, durationMs: now() - startedAt, workingHeapDeltaBytes: Math.max(0, process.memoryUsage().heapUsed - startingHeapBytes), memoryBudgetExceeded, store: featureStore.stats() },
  };
}
