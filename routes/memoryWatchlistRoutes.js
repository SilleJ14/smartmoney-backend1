const mb = (bytes) => Number((bytes / 1024 / 1024).toFixed(2));

export function buildMemoryStatus(state, memory, updatedAt) {
  return {
    ok: true, updatedAt,
    processMemory: { rssMb: mb(memory.rss), heapUsedMb: mb(memory.heapUsed), heapTotalMb: mb(memory.heapTotal), externalMb: mb(memory.external) },
    engineMemory: {
      runnerPredictionHistory: state.runnerPredictionHistory?.length || 0,
      runnerLearningResults: state.runnerLearningResults?.length || 0,
      runnerWatchlistHistory: state.runnerWatchlistHistory?.length || 0,
      fastRunnerCandidates: state.fastRunnerCandidates?.length || 0,
      topRunnerWatchlist: state.topRunnerWatchlist?.length || 0,
      highAlertRunnerStocks: state.highAlertRunnerStocks?.length || 0,
      liveQuoteSymbols: Object.keys(state.liveQuoteCache || {}).length,
      liveMarketMemorySymbols: Object.keys(state.liveMarketMemory || {}).length,
    },
  };
}

export function buildWatchlistSnapshot(state, kind, updatedAt) {
  const swing = kind === "swing";
  return swing ? {
    ok: true, updatedAt, swingWatchlistState: state.swingWatchlistState || null,
    topSwingWatchlist: (state.topSwingWatchlist || []).slice(0, 25),
    highConfidenceSwingStocks: (state.highConfidenceSwingStocks || []).slice(0, 10),
    swingPredictionHistory: (state.swingPredictionHistory || []).slice(0, 50),
    swingLearningState: state.swingLearningState || null,
    swingLearningResults: (state.swingLearningResults || []).slice(0, 50),
    swingWatchlistHistory: (state.swingWatchlistHistory || []).slice(0, 25),
  } : {
    ok: true, updatedAt, runnerWatchlistState: state.runnerWatchlistState || null,
    topRunnerWatchlist: (state.topRunnerWatchlist || []).slice(0, 25),
    highAlertRunnerStocks: (state.highAlertRunnerStocks || []).slice(0, 10),
    fastRunnerCandidates: (state.fastRunnerCandidates || []).slice(0, 25),
    visibleLiveCandidates: (state.visibleLiveCandidates || []).slice(0, 25),
    runnerPredictionHistory: (state.runnerPredictionHistory || []).slice(0, 50),
    runnerLearningState: state.runnerLearningState || null,
    runnerLearningResults: (state.runnerLearningResults || []).slice(0, 50),
    runnerWatchlistHistory: (state.runnerWatchlistHistory || []).slice(0, 25),
  };
}

export function registerMemoryWatchlistRoutes(app, { requireAdmin, getState, saveRenderMemory, memoryUsage = () => process.memoryUsage(), now = () => new Date() }) {
  app.get("/api/memory-status", requireAdmin, (_req, res) => res.json(buildMemoryStatus(getState(), memoryUsage(), now().toISOString())));
  for (const kind of ["swing", "runner"]) app.get(`/api/${kind}-watchlist`, requireAdmin, (_req, res) => {
    try {
      saveRenderMemory(`${kind.toUpperCase()}_WATCHLIST_ROUTE_READ`);
      res.json(buildWatchlistSnapshot(getState(), kind, now().toISOString()));
    } catch (error) { res.status(500).json({ ok: false, error: error.message }); }
  });
}
