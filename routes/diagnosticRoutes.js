export function buildTelemetry(state, freshness) {
  return {
    engine: { running: state.running, marketOpen: state.marketOpen, lastScanAt: state.lastScanAt,
      lastHeartbeatAt: state.lastHeartbeatAt, lastSuccessfulCycleAt: state.lastSuccessfulCycleAt,
      lastTickDurationMs: state.lastTickDurationMs, totalEngineTicks: state.totalEngineTicks,
      engineFreezeDetected: state.engineFreezeDetected, engineFreezeCount: state.engineFreezeCount,
      lastEngineStopReason: state.lastEngineStopReason },
    freshness, marketRegime: state.marketRegime, marketStressLevel: state.marketStressLevel,
    averageSignalScore: state.averageSignalScore, confidenceWeightedMode: state.averageSignalScore >= 90,
    marketBreadth: state.marketBreadth, marketMomentumScore: state.marketMomentumScore,
    marketVolatility: state.marketVolatility, institutionalExposureMode: state.institutionalExposureMode,
    institutionalWatchlist: state.institutionalWatchlist, analyticsSnapshots: state.analyticsSnapshots?.slice(0, 20) || [],
    statisticalMemoryState: state.statisticalMemoryState || { updatedAt: null, setupHistory: [], setupPerformance: {}, expectancyHistory: [], probabilityHistory: [] },
    statisticalEdgeState: state.statisticalEdgeState || null,
    statisticalEdgeHistory: (state.statisticalEdgeHistory || []).slice(0, 20), apiHealth: state.apiHealth || {},
    recentSignals: state.signalHistory?.slice(0, 20) || [], activeCooldowns: Object.keys(state.symbolCooldowns || {}),
    decisionScores: (state.lastSignals || state.lastStockSignals || []).slice(0, 20).map((signal) => ({
      symbol: signal.symbol,
      telemetry: signal.decisionScoreTelemetry || null,
    })),
    liveTradeLimits: state.liveTradeLimitState || {
      dateKey: null,
      intradayStockEntriesToday: 0,
      positionIntents: {},
    },
    boundedQuietDiscovery: state.boundedQuietDiscoveryState || null,
    recentRegimes: state.marketRegimeHistory?.slice(0, 20) || [],
  };
}

export function registerDiagnosticRoutes(app, dependencies) {
  const { requireAdmin, getState, getConfig, getAccount, getClock, getTopMovers, getPositions,
    getBotOwnedSymbols, isManagedPosition, getBotExposure, getMaxSymbols, getFreshness } = dependencies;
  app.get("/debug", requireAdmin, async (_req, res) => {
    const state = getState();
    try {
      const [account, clock, symbols, positions] = await Promise.all([getAccount(), getClock(), getTopMovers(), getPositions()]);
      state.cachedAccount = account; state.cachedPositions = positions;
      const owned = await getBotOwnedSymbols(), managed = positions.filter((position) => isManagedPosition(position, owned));
      const config = getConfig(), maxSymbolsToScan = getMaxSymbols(), limited = symbols.slice(0, maxSymbolsToScan);
      res.json({ ok: true, accountStatus: account.status, marketOpen: clock.is_open, symbolsCount: symbols.length,
        maxSymbolsToScan, symbolsThatWouldScan: limited.length, firstSymbols: limited.slice(0, 30),
        lastSignalsCount: state.lastSignals.length, skippedSymbolsCount: state.skippedSymbols.length,
        recentSkippedSymbols: state.skippedSymbols.slice(0, 20), config,
        adaptiveSwingRisk: { mode: "SWING_ADAPTIVE",
          stock: { stopLossPercent: config.stopLossPercent, trailingStopPercent: config.trailingStopPercent, takeProfitPercent: config.takeProfitPercent },
          crypto: { stopLossPercent: -4, trailingStopPercent: -3, takeProfitPercent: 8 },
          runner: { triggerPercent: config.runnerTriggerPercent, trailingStopPercent: config.runnerTrailingStopPercent },
          engineState: state.adaptiveRiskState || null, description: "Adaptive swing exits active with wider institutional breathing room." },
        risk: { equity: Number(account.equity || 0), cash: Number(account.cash || 0),
          maxBotBudget: Number(account.equity || 0) * (config.maxBotExposurePercent / 100),
          currentBotExposure: getBotExposure(managed), perTradeMax: (Number(account.equity || 0) * (config.maxBotExposurePercent / 100)) / config.maxOpenTrades },
        engineState: state });
    } catch (error) { res.status(500).json({ ok: false, error: error.message, engineState: state }); }
  });
  app.get("/telemetry", requireAdmin, (_req, res) => res.json(buildTelemetry(getState(), getFreshness())));
}
