export const DEFAULT_ENGINE_HISTORY_LIMIT = 50;
export const HEAVY_ENGINE_HISTORY_LIMIT = 20;

const HEAVY_SIGNAL_HISTORY_KEYS = new Set([
  "explosiveRunnerHistory",
  "fullInstitutionalAiBrainHistory",
  "autonomousMetaStrategyHistory",
  "premarketDominanceHistory",
  "signalHistory",
]);

const CURRENT_SIGNAL_COLLECTION_KEYS = new Set([
  "lastSignals",
  "topSignals",
  "lastStockSignals",
  "topStockSignals",
  "lastCryptoSignals",
  "topCryptoSignals",
  "fastRunnerCandidates",
  "quickInstitutionalCandidates",
]);

function removeDuplicatedSignalBars(signal = {}) {
  if (
    !signal ||
    typeof signal !== "object" ||
    !Array.isArray(signal.chartBars) ||
    !Array.isArray(signal.historicalBars)
  ) {
    return signal;
  }
  const { historicalBars: _duplicatedHistoricalBars, ...compactSignal } = signal;
  return compactSignal;
}

function compactSignalForHistory(signal = {}) {
  if (!signal || typeof signal !== "object") return signal;
  return {
    symbol: signal.symbol || null,
    assetClass: signal.assetClass || signal.asset_class || signal.assetType || null,
    score: Number(signal.score || 0),
    rawCryptoScore: Number(signal.rawCryptoScore || 0),
    cryptoEntryScore: Number(signal.cryptoEntryScore || 0),
    cryptoDecisionScore: Number(signal.cryptoDecisionScore || 0),
    multiDayScore: Number(signal.multiDayScore || signal.multiDayProbability || 0),
    runnerScore: Number(
      signal.runnerScore ||
      signal.explosiveRunnerScore ||
      signal.explosiveRunnerPrediction?.explosiveRunnerScore ||
      0
    ),
    price: Number(signal.current || signal.price || signal.displayPrice || 0),
    percentChange: Number(signal.percentChange || signal.changePercent || 0),
    volumeRatio: Number(
      signal.volumeRatio ||
      signal.relativeVolume ||
      signal.confirmations?.volumeSpikeRatio ||
      0
    ),
    institutionalBrainScore: Number(signal.institutionalBrainScore || 0),
    qualifiedToBuy: signal.qualifiedToBuy === true,
    autoTradeApproved: signal.autoTradeApproved === true,
    decisionLevel: signal.decisionLevel || null,
    tradeQuality: signal.tradeQuality || null,
    updatedAt:
      signal.updatedAt ||
      signal.scanBuiltAt ||
      signal.quoteFetchedAt ||
      null,
  };
}

function compactSignalArray(items, limit = 10) {
  return (Array.isArray(items) ? items : [])
    .slice(0, limit)
    .map(compactSignalForHistory);
}

function compactRunnerWatchlist(watchlist = {}) {
  if (!watchlist || typeof watchlist !== "object") return null;
  return {
    updatedAt: watchlist.updatedAt || null,
    reviewedCount: Number(watchlist.reviewedCount || 0),
    top10: compactSignalArray(watchlist.top10, 10),
    top25: compactSignalArray(watchlist.top25, 10),
    highAlertStocks: compactSignalArray(watchlist.highAlertStocks, 10),
  };
}

function compactHeavyHistoryEntry(key, entry = {}) {
  if (!entry || typeof entry !== "object") return entry;
  const common = {
    updatedAt: entry.updatedAt || entry.timestamp || null,
    phase: entry.phase || null,
    reviewedCount: Number(entry.reviewedCount || entry.signalCount || 0),
    reason: entry.reason || null,
  };
  if (key === "explosiveRunnerHistory") {
    return {
      ...common,
      topEarlyRunnerCount: Number(entry.topEarlyRunnerCount || 0),
      topTwoSymbols: (entry.topTwoSymbols || []).slice(0, 5),
      topEarlyRunners: compactSignalArray(entry.topEarlyRunners, 10),
      runnerWatchlist: compactRunnerWatchlist(entry.runnerWatchlist),
    };
  }
  if (key === "fullInstitutionalAiBrainHistory") {
    return {
      ...common,
      masterOpportunityCount: Number(entry.masterOpportunityCount || 0),
      topTwoSymbols: (entry.topTwoSymbols || []).slice(0, 5),
      rankedOpportunities: compactSignalArray(entry.rankedOpportunities, 10),
      masterOpportunities: compactSignalArray(entry.masterOpportunities, 10),
    };
  }
  if (key === "autonomousMetaStrategyHistory") {
    return {
      ...common,
      dominantStrategy: entry.dominantStrategy || null,
      capitalRoutingMode: entry.capitalRoutingMode || null,
      marketRegime: entry.marketRegime || null,
      macroStress: Number(entry.macroStress || 0),
      topTwoSymbols: (entry.topTwoSymbols || []).slice(0, 5),
      strategyRanking: (entry.strategyRanking || []).slice(0, 10),
      rankedSignals: compactSignalArray(entry.rankedSignals, 10),
    };
  }
  if (key === "premarketDominanceHistory") {
    return {
      ...common,
      isPremarketWindow: entry.isPremarketWindow === true,
      isMorningStrikeWindow: entry.isMorningStrikeWindow === true,
      sniperCount: Number(entry.sniperCount || 0),
      topTwoSymbols: (entry.topTwoSymbols || []).slice(0, 5),
      sniperCandidates: compactSignalArray(entry.sniperCandidates, 10),
      dominanceRadar: compactSignalArray(entry.dominanceRadar, 10),
    };
  }
  return {
    timestamp: entry.timestamp || entry.updatedAt || null,
    signalCount: Number(entry.signalCount || entry.reviewedCount || 0),
    averageTopScore: Number(entry.averageTopScore || 0),
    topSignals: compactSignalArray(entry.topSignals, 10),
  };
}

function boundStockScoreOutcomeState(outcomeState) {
  if (!outcomeState || typeof outcomeState !== "object") return outcomeState;
  const observations = Array.isArray(outcomeState.observations)
    ? outcomeState.observations.slice(0, 500)
    : [];
  return {
    ...outcomeState,
    maxObservations: Math.max(
      1,
      Math.min(500, Number(outcomeState.maxObservations || 500))
    ),
    observationCount: observations.length,
    observations,
  };
}

export function compactLiveEngineStateHistories(
  state = {},
  {
    defaultLimit = DEFAULT_ENGINE_HISTORY_LIMIT,
    heavyLimit = HEAVY_ENGINE_HISTORY_LIMIT,
  } = {}
) {
  for (const key of Object.keys(state)) {
    const value = state[key];
    if (CURRENT_SIGNAL_COLLECTION_KEYS.has(key) && Array.isArray(value)) {
      state[key] = value.map(removeDuplicatedSignalBars);
      continue;
    }
    if (!key.endsWith("History") || !Array.isArray(value)) continue;
    if (HEAVY_SIGNAL_HISTORY_KEYS.has(key)) {
      state[key] = value
        .slice(0, heavyLimit)
        .map((entry) => compactHeavyHistoryEntry(key, entry));
    } else {
      state[key] = value.slice(0, defaultLimit);
    }
  }
  state.stockScoreOutcomeState = boundStockScoreOutcomeState(
    state.stockScoreOutcomeState
  );
  return state;
}

export function compactPersistedEngineStateSnapshot(snapshot = {}) {
  const compact = { ...snapshot };

  compact.liveMarketMemory = {};
  compact.liveQuoteCache = {};

  compact.analyticsSnapshots = (compact.analyticsSnapshots || []).slice(0, 50);
  compact.institutionalDashboardSnapshots = (compact.institutionalDashboardSnapshots || []).slice(0, 50);
  compact.aiDecisionHistory = (compact.aiDecisionHistory || []).slice(0, 150);

  compactLiveEngineStateHistories(compact);

  compact.sectorDominanceState =
    compact.sectorDominanceState || compact.sectorDominationState || null;

  compact.sectorDominanceHistory =
    compact.sectorDominanceHistory || compact.sectorDominationHistory || [];

  delete compact.sectorDominationState;
  delete compact.sectorDominationHistory;

  compact.autonomousCryptoStrategySelectorState =
    compact.autonomousCryptoStrategySelectorState ||
    compact.phase52CryptoStrategySelectorState ||
    null;

  compact.autonomousCryptoStrategySelectorHistory =
    compact.autonomousCryptoStrategySelectorHistory ||
    compact.phase52CryptoStrategyHistory ||
    compact.phase52CryptoStrategySelectorHistory ||
    [];

  delete compact.phase52CryptoStrategySelectorState;
  delete compact.phase52CryptoStrategySelectorHistory;

  return compact;
}
