function mappedSignals(primary, fallback, mergeLiveQuote) {
  return (primary?.length ? primary : fallback || []).map(mergeLiveQuote);
}

function liveStreamState(state, includeCrypto = true) {
  return {
    polygon: state.polygonLiveStreamState || null,
    ...(includeCrypto ? { polygonCrypto: state.polygonCryptoLiveStreamState || null } : {}),
    ...(includeCrypto ? { finnhub: state.liveQuoteStreamState || null } : {}),
    fastRunner: state.fastRunnerEngineState || null,
    quickGate: state.quickInstitutionalGateState || null,
    starterBuy: state.liveStarterBuyGateState || null,
  };
}

function compactOutcomeStatus(state) {
  const outcomeState = state.stockScoreOutcomeState;
  if (!outcomeState || typeof outcomeState !== "object") return null;
  const { observations: _observations, ...status } = outcomeState;
  return {
    ...status,
    retainedObservationCount: Array.isArray(outcomeState.observations)
      ? outcomeState.observations.length
      : Number(outcomeState.observationCount || 0),
    observationsIncluded: false,
  };
}

export function registerStatusRoutes(app, dependencies) {
  const {
    requireAdmin,
    getState,
    getRuntime,
    refreshAccountCache,
    getLatestStatus,
    mergeLiveQuote,
    getAccount,
    updateAccountPeaks,
    getClock,
    getPositions,
    getBotOwnedSymbols,
    getOpenOrders,
    reconcileBrokerState,
    normalizeSymbol,
    isManagedPosition,
    getBotExposure,
    buildInstitutionalDashboard,
    buildHighConvictionSummary,
    buildTopBrains,
    summarizeQuietCandidateOutcomes = () => null,
    buildProofReport = () => null,
  } = dependencies;

  app.get("/status", requireAdmin, async (req, res) => {
    try {
      const accountRefresh = await refreshAccountCache();
      const latestStatus = getLatestStatus();
      const state = getState();
      const runtime = getRuntime();
      const quietDiscoveryProof = summarizeQuietCandidateOutcomes(
        state.quietCandidateOutcomeState,
        {
          learning: state.quietCandidateOutcomeLearning,
          stockDiscoveryState: state.boundedQuietDiscoveryState,
          cryptoDiscoveryState: state.cryptoQuietDiscoveryState,
        }
      );
      res.json({
        ok: true,
        lightweight: true,
        generatedAt: new Date().toISOString(),
        online: true,
        mode: runtime.mode,
        effectiveMode: state.effectiveMode,
        tradingModeLocked: runtime.tradingModeLocked,
        autoTradingEnabled: runtime.autoTradingEnabled,
        emergencyStopActive: runtime.emergencyStopActive,
        config: runtime.config || {},
        marketOpen: state.marketOpen,
        marketRegime: state.marketRegime,
        marketStressLevel: state.marketStressLevel,
        marketMomentumScore: state.marketMomentumScore,
        marketVolatility: state.marketVolatility,
        marketBreadth: state.marketBreadth,
        institutionalExposureMode: state.institutionalExposureMode,
        lastScanAt: state.lastScanAt,
        lastHeartbeatAt: state.lastHeartbeatAt,
        lastSuccessfulCycleAt: state.lastSuccessfulCycleAt,
        lastTickDurationMs: state.lastTickDurationMs,
        lastError: state.lastError,
        liveQuoteStreamState: state.liveQuoteStreamState || null,
        polygonLiveStreamState: state.polygonLiveStreamState || null,
        liveEarlyMoverRefreshState: state.liveEarlyMoverRefreshState || null,
        signalCount: latestStatus.signalCount,
        stockSignalCount: latestStatus.stockSignalCount,
        cryptoSignalCount: latestStatus.cryptoSignalCount,
        topStockSignals: latestStatus.topStockSignals || [],
        topCryptoSignals: latestStatus.topCryptoSignals || [],
        fastRunnerCandidates: (state.fastRunnerCandidates || []).slice(0, 25).map(mergeLiveQuote),
        quickInstitutionalCandidates: (state.quickInstitutionalCandidates || []).slice(0, 25).map(mergeLiveQuote),
        liveStarterBuyGateState: state.liveStarterBuyGateState || null,
        institutionalDashboard: latestStatus.institutionalDashboard || {},
        engineState: {
          marketOpen: state.marketOpen === true,
          marketRegime: state.marketRegime || null,
          marketStressLevel: state.marketStressLevel ?? null,
          marketMomentumScore: state.marketMomentumScore ?? null,
          marketVolatility: state.marketVolatility ?? null,
          marketBreadth: state.marketBreadth ?? null,
          lastScanAt: state.lastScanAt || null,
          lastHeartbeatAt: state.lastHeartbeatAt || null,
          lastSuccessfulCycleAt: state.lastSuccessfulCycleAt || null,
          dailyLossLocked: state.dailyLossLocked === true,
          profitLocked: state.profitLocked === true,
          liveStarterBuyGateState: state.liveStarterBuyGateState || null,
          fastRunnerEngineState: state.fastRunnerEngineState || null,
          quickInstitutionalGateState: state.quickInstitutionalGateState || null,
        },
        stockScoreOutcomeSummary: state.stockScoreOutcomeSummary || {},
        stockScoreOutcomeStatus: compactOutcomeStatus(state),
        stockScoreOutcomeLearning: state.stockScoreOutcomeLearning || null,
        quietDiscoveryProof,
        quietDiscoveryAdvancedProof: buildProofReport(state.quietCandidateOutcomeState),
        account: latestStatus?.account || state.cachedAccount || null,
        risk: latestStatus?.risk || null,
        statusAccountRefresh: accountRefresh,
        note: "Lightweight status. Use /status/full for full broker/account/order debug payload.",
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: "Failed to load lightweight status",
        details: err.message,
        generatedAt: new Date().toISOString(),
      });
    }
  });

  app.get("/status/full", requireAdmin, async (req, res) => {
    const state = getState();
    const runtime = getRuntime();
    try {
      const account = await getAccount();
      const peaks = updateAccountPeaks(account);
      const clock = await getClock();
      const positions = await getPositions();
      const managedSymbols = await getBotOwnedSymbols();
      const openOrders = await getOpenOrders();
      const brokerReconciliation = reconcileBrokerState({
        positions,
        openOrders,
        managedSymbols,
        enginePendingExits: state.pendingExits || [],
        normalizeSymbol,
      });
      const pendingExits = brokerReconciliation.pendingExits;
      const managedPositions = positions.filter((position) => isManagedPosition(position, managedSymbols));
      const config = runtime.config;
      res.json({
        institutionalDashboard: buildInstitutionalDashboard(),
        highConvictionInstitutionalSummary: buildHighConvictionSummary(5),
        online: true,
        mode: runtime.mode,
        effectiveMode: state.effectiveMode,
        tradingModeLocked: runtime.tradingModeLocked,
        autoTradingEnabled: runtime.autoTradingEnabled,
        config,
        signals: mappedSignals(state.topSignals, state.lastSignals, mergeLiveQuote),
        stockSignals: mappedSignals(state.topStockSignals, state.lastStockSignals, mergeLiveQuote),
        cryptoSignals: mappedSignals(state.topCryptoSignals, state.lastCryptoSignals, mergeLiveQuote),
        liveStreamState: liveStreamState(state),
        account: { ...account, peakEquity: peaks.peakEquity, peakCash: peaks.peakCash },
        clock,
        topAiBrains: buildTopBrains(),
        pendingExits,
        brokerReconciliation,
        openExitOrderCount: pendingExits.filter((exit) => exit.source === "alpaca_open_order").length,
        pdtProtectedPendingExitCount: pendingExits.filter(
          (exit) => exit.source === "engine_pdt_or_ai_pending"
        ).length,
        risk: {
          maxBotExposurePercent: config.maxBotExposurePercent,
          maxBotBudget: Number(account.equity || 0) * (config.maxBotExposurePercent / 100),
          currentBotExposure: getBotExposure(managedPositions),
          perTradeMax:
            (Number(account.equity || 0) * (config.maxBotExposurePercent / 100)) /
            config.maxOpenTrades,
          currentEquity: Number(account.equity || 0),
          currentCash: Number(account.cash || 0),
          peakEquity: peaks.peakEquity,
          peakCash: peaks.peakCash,
        },
        autonomousTradingSystem: state.autonomousTradingSystemState || null,
        phase20AutonomousOrchestration: state.phase20AutonomousOrchestrationState || null,
        crossEngineMemory: state.crossEngineMemoryState || null,
        adaptiveExecutionTiming: state.adaptiveExecutionTimingState || null,
        phase21AutonomousBrain: state.phase21AutonomousBrainState || null,
        executionIntelligence: state.executionIntelligenceState || null,
        reinforcementWeights: state.reinforcementWeightState || null,
        selfOptimization: state.selfOptimizationState || null,
        marketCycleIntelligence: state.marketCycleIntelligenceState || null,
        liquidityIntelligence: state.liquidityIntelligenceState || null,
        correlationIntelligence: state.correlationIntelligenceState || null,
        portfolioGovernor: state.portfolioGovernorState || null,
        engineState: {
          ...state,
          stockScoreOutcomeState: compactOutcomeStatus(state),
          lastSignals: (state.lastSignals || []).map(mergeLiveQuote),
          lastStockSignals: (state.lastStockSignals || []).map(mergeLiveQuote),
          lastCryptoSignals: (state.lastCryptoSignals || []).map(mergeLiveQuote),
          topSignals: (state.topSignals || []).map(mergeLiveQuote),
          topStockSignals: (state.topStockSignals || []).map(mergeLiveQuote),
          topCryptoSignals: (state.topCryptoSignals || []).map(mergeLiveQuote),
        },
      });
    } catch (err) {
      console.error("/status route failed:", err.message);
      res.json({
        online: true,
        degradedMode: true,
        statusWarnings: [err.message],
        mode: runtime.mode,
        effectiveMode: state.effectiveMode,
        tradingModeLocked: runtime.tradingModeLocked,
        autoTradingEnabled: runtime.autoTradingEnabled,
        config: runtime.config,
        institutionalDashboard: buildInstitutionalDashboard(),
        signals: mappedSignals(state.topSignals, state.lastSignals, mergeLiveQuote),
        stockSignals: mappedSignals(state.topStockSignals, state.lastStockSignals, mergeLiveQuote),
        cryptoSignals: mappedSignals(state.topCryptoSignals, state.lastCryptoSignals, mergeLiveQuote),
        liveStreamState: liveStreamState(state, false),
        engineState: {
          ...state,
          stockScoreOutcomeState: compactOutcomeStatus(state),
          lastError: err.message,
        },
      });
    }
  });
}
