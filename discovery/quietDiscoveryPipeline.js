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

export function compactGroupedRows(results = [], dateKey, maxUniverse = 5000) {
  return results.slice(0, maxUniverse).map((item) => ({
    s: String(item.T || item.symbol || "").toUpperCase(), d: dateKey,
    o: Number(item.o || item.open || 0), h: Number(item.h || item.high || 0),
    l: Number(item.l || item.low || 0), c: Number(item.c || item.close || 0),
    v: Number(item.v || item.volume || 0),
  })).filter((row) => row.s && row.c > 0 && row.h >= row.l && row.v >= 0);
}

export function calculateQuietPreMoveFeatures(history = []) {
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
  const preMoveScore = clamp(compressionScore * 0.28 + accumulationScore * 0.27 + structureScore * 0.2 + quietScore * 0.15 + liquidityScore * 0.1);
  return { symbol: latest.s, preMoveScore: Number(preMoveScore.toFixed(2)), compressionScore: Number(compressionScore.toFixed(2)), accumulationScore: Number(accumulationScore.toFixed(2)), structureScore: Number(structureScore.toFixed(2)), quietScore: Number(quietScore.toFixed(2)), liquidityScore: Number(liquidityScore.toFixed(2)), dayChangePercent: Number(dayChangePercent.toFixed(2)), twentyDayChange: Number(twentyDayChange.toFixed(2)), averageDollarVolume: Number((latest.c * avg(history.slice(-20).map((row) => row.v))).toFixed(2)), historyDays: history.length };
}

export async function runBoundedQuietDiscovery({ groupedResults = [], dateKey, featureStore, budgets = {}, downloadedBytes = 0, now = () => Date.now() } = {}) {
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
      const features = calculateQuietPreMoveFeatures(history);
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
