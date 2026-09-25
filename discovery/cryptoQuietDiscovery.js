import { calculateCryptoEarlyDiscoveryScore } from "../scoring/earlyDiscovery.js";
import { providerDailyBar } from "./providerDailyBar.js";

export const DEFAULT_CRYPTO_DISCOVERY_BUDGETS = Object.freeze({
  watchlistSize: 25,
  historyDays: 60,
  maxUniverse: 300,
  maxWorkingMemoryMb: 48,
});

export function cryptoDiscoveryDailyRows(symbol, bars = [], { now = Date.now() } = {}) {
  const byDay = new Map();
  for (const bar of Array.isArray(bars) ? bars : []) {
    const dated = providerDailyBar(symbol, bar, { now });
    if (!dated) continue;
    const day = dated.utcDate || dated.d;
    byDay.set(day, {
      s: String(symbol || "").toUpperCase(),
      d: day,
      o: dated.o,
      h: dated.h,
      l: dated.l,
      c: dated.c,
      v: dated.v,
    });
  }
  return [...byDay.values()];
}

function historyToDailyBars(history = []) {
  return (Array.isArray(history) ? history : []).map((row) => ({
    t: `${row.d}T00:00:00.000Z`,
    o: row.o,
    h: row.h,
    l: row.l,
    c: row.c,
    v: row.v,
  }));
}

export async function runBoundedCryptoQuietDiscovery({
  featureStore,
  dailyRows = [],
  scanCandidates = [],
  reviewedCount = 0,
  now = Date.now(),
  budgets = {},
} = {}) {
  const config = { ...DEFAULT_CRYPTO_DISCOVERY_BUDGETS, ...budgets };
  const startedAt = Number(now);
  const startingHeapBytes = process.memoryUsage().heapUsed;
  const byDay = new Map();
  for (const row of Array.isArray(dailyRows) ? dailyRows : []) {
    if (!row?.d || !row?.s) continue;
    if (!byDay.has(row.d)) byDay.set(row.d, []);
    byDay.get(row.d).push(row);
  }
  const writtenDays = [];
  const sortedDays = [...byDay.keys()].sort();
  const latestDay = sortedDays.at(-1);
  if (featureStore && latestDay && typeof featureStore.mergeDaily === "function") {
    writtenDays.push(featureStore.mergeDaily(latestDay, byDay.get(latestDay)));
    await new Promise((resolve) => setImmediate(resolve));
  }
  const scanWatchlist = Array.isArray(scanCandidates) ? scanCandidates : [];
  const scanSymbols = new Set(scanWatchlist.map((item) => item.symbol));
  const prioritySymbols = [...new Set((Array.isArray(dailyRows) ? dailyRows : []).map((row) => row.s).filter(Boolean))];
  const read = featureStore
    ? await featureStore.readRecentHistories({
      days: config.historyDays,
      maxSymbols: Math.min(config.maxUniverse, Math.max(prioritySymbols.length, config.watchlistSize * 4)),
      prioritySymbols,
    })
    : { histories: new Map(), rowsRead: 0, filesRead: 0 };
  const ranked = [];
  let memoryBudgetExceeded = false;
  const storedEntries = [...(read.histories || [])].filter(([symbol]) => !scanSymbols.has(symbol));
  for (let index = 0; index < storedEntries.length; index += 25) {
    for (const [symbol, history] of storedEntries.slice(index, index + 25)) {
      const scorecard = calculateCryptoEarlyDiscoveryScore({
        symbol,
        dailyBars: historyToDailyBars(history),
        now,
      });
      if (Number(scorecard.score || 0) < 58 && scorecard.setupState !== "EXTENDED" && scorecard.setupState !== "EXHAUSTED") continue;
      ranked.push({
        symbol,
        assetClass: "crypto",
        candidateSource: scorecard.setupState === "EARLY" ? "EARLY_DISCOVERY" : "SETUP_STATE",
        setupState: scorecard.setupState,
        earlyEntryEligible: scorecard.earlyEntryEligible === true,
        newLongEntryAllowed: scorecard.newLongEntryAllowed !== false,
        extensionEvidence: scorecard.extensionEvidence,
        current: Number(history.at(-1)?.c || 0),
        cryptoDiscoveryScore: Number(scorecard.score || 0),
        cryptoDiscoveryTier: scorecard.tier,
        cryptoDiscoveryScorecard: {
          stage: scorecard.stage,
          score: scorecard.score,
          rawScore: scorecard.rawScore,
          coverage: scorecard.coverage,
          components: scorecard.components,
          extension: scorecard.extension,
          setupState: scorecard.setupState,
          extensionEvidence: scorecard.extensionEvidence,
          gates: scorecard.gates,
          dataQuality: scorecard.dataQuality,
        },
        newsCatalyst: null,
      });
      if (process.memoryUsage().heapUsed - startingHeapBytes > config.maxWorkingMemoryMb * 1024 * 1024) {
        memoryBudgetExceeded = true;
        break;
      }
    }
    if (memoryBudgetExceeded) break;
    await new Promise((resolve) => setImmediate(resolve));
  }
  ranked.sort((a, b) => Number(b.cryptoDiscoveryScore || 0) - Number(a.cryptoDiscoveryScore || 0));
  const storedWatchlist = ranked.slice(0, config.watchlistSize);
  const bySymbol = new Map(scanWatchlist.map((item) => [item.symbol, item]));
  for (const item of storedWatchlist) {
    if (!bySymbol.has(item.symbol)) bySymbol.set(item.symbol, item);
  }
  const topCandidates = [...bySymbol.values()]
    .sort((a, b) => Number(b.cryptoDiscoveryScore || 0) - Number(a.cryptoDiscoveryScore || 0))
    .slice(0, config.watchlistSize);
  return {
    ok: memoryBudgetExceeded !== true,
    partial: memoryBudgetExceeded === true,
    phase: "BOUNDED_CRYPTO_QUIET_DISCOVERY",
    updatedAt: new Date(now).toISOString(),
    reviewedCount: Number(reviewedCount || read.histories?.size || 0),
    selectedCount: topCandidates.length,
    storedCandidateCount: storedWatchlist.length,
    writtenDays: writtenDays.length,
    topCandidates,
    reason: topCandidates.length > 0
      ? "Quiet crypto candidates selected from the bounded daily store."
      : "No quiet crypto candidate met the current discovery floor.",
    resourceUsage: {
      rowsRead: read.rowsRead,
      filesRead: read.filesRead,
      durationMs: Number(now) - startedAt,
      memoryBudgetExceeded,
      store: featureStore?.stats?.() || null,
    },
  };
}
