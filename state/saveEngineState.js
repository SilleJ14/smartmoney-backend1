import {
  compactLiveEngineStateHistories,
  compactPersistedEngineStateSnapshot,
} from "./compactEngineState.js";
import { pruneEngineState } from "./pruneEngineState.js";
import { writeJsonAtomic } from "./safeJson.js";

export function createEngineStateSaver({
  ENGINE_STATE_FILE,
  engineState,
  getEffectiveTradingMode,
  writeState = writeJsonAtomic,
  saveDelayMs = 1000,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
}) {
  let engineStateSaveTimer = null;
  let pendingEngineStateSnapshot = null;
  let pendingEngineStateReason = "STATE_UPDATE";
  let stateWritePromise = null;
  let lastWriteError = null;
  let completedWriteCount = 0;

  function flushEngineStateSave() {
    if (engineStateSaveTimer) {
      clearTimeoutFn(engineStateSaveTimer);
      engineStateSaveTimer = null;
    }
    if (stateWritePromise) return stateWritePromise;
    if (!pendingEngineStateSnapshot) return Promise.resolve();

    stateWritePromise = (async () => {
      while (pendingEngineStateSnapshot) {
        const snapshot = pendingEngineStateSnapshot;
        pendingEngineStateSnapshot = null;
        try {
          await writeState(ENGINE_STATE_FILE, snapshot);
          completedWriteCount += 1;
          lastWriteError = null;
        } catch (err) {
          lastWriteError = err?.message || String(err);
          console.error("Async engine-state save failed:", lastWriteError);
        }
      }
    })().finally(() => {
      stateWritePromise = null;
      if (pendingEngineStateSnapshot && !engineStateSaveTimer) {
        engineStateSaveTimer = setTimeoutFn(() => {
          engineStateSaveTimer = null;
          void flushEngineStateSave();
        }, 0);
      }
    });

    return stateWritePromise;
  }

  function saveEngineState(reason = "STATE_UPDATE") {
    try {
      compactLiveEngineStateHistories(engineState);
      const safeState = {
        reason,
        savedAt: new Date().toISOString(),

        dailyStartEquity: engineState.dailyStartEquity,
        dailyPeakEquity: engineState.dailyPeakEquity,
        profitLockFloorEquity: engineState.profitLockFloorEquity,
        dailyDateKey: engineState.dailyDateKey,
        lastScanDurationMs: engineState.lastScanDurationMs || null,
        effectiveMode: engineState.effectiveMode || getEffectiveTradingMode(false),
        liveQuoteStreamState: engineState.liveQuoteStreamState || null,

        stockTradingStoppedForDay: engineState.stockTradingStoppedForDay || false,
        cryptoTradingStoppedForDay: engineState.cryptoTradingStoppedForDay || false,

        lastTradingDayKey: engineState.lastTradingDayKey || null,
        lastMarketOpen:
          engineState.lastMarketOpen === true || engineState.lastMarketOpen === false
            ? engineState.lastMarketOpen
            : null,

        marketClosedAt: engineState.marketClosedAt || null,
        openingBellTriggeredAt: engineState.openingBellTriggeredAt || null,

        dailyLossLocked: engineState.dailyLossLocked,
        profitLocked: engineState.profitLocked,

        highWaterMarks: engineState.highWaterMarks || {},
        tradeMemory: engineState.tradeMemory || {},
        aiEntryScores: engineState.aiEntryScores || {},
        runnerPositions: engineState.runnerPositions || {},
        lastSoldAt: engineState.lastSoldAt || {},
        peaksByMode: engineState.peaksByMode || {},
        aiManagedSymbols: engineState.aiManagedSymbols || [],
        institutionalWatchlist: engineState.institutionalWatchlist || [],

        analyticsSnapshots: (engineState.analyticsSnapshots || []).slice(0, 100),

        apiHealth: engineState.apiHealth || {},
        apiFailureCounts: engineState.apiFailureCounts || {},
        apiCooldowns: engineState.apiCooldowns || {},

        signalHistory: (engineState.signalHistory || []).slice(0, 200),
        marketRegimeHistory: (engineState.marketRegimeHistory || []).slice(0, 200),

        marketRegimeDominanceState: engineState.marketRegimeDominanceState || null,
        marketRegimeDominanceHistory:
          (engineState.marketRegimeDominanceHistory || []).slice(0, 200),

        sectorStrengthHistory: (engineState.sectorStrengthHistory || []).slice(0, 200),
        sectorRotationState: engineState.sectorRotationState || null,
        sectorRotationHistory: (engineState.sectorRotationHistory || []).slice(0, 200),

        sectorDominationState:
          engineState.sectorDominationState || engineState.sectorDominanceState || null,

        sectorDominationHistory:
          (
            engineState.sectorDominationHistory ||
            engineState.sectorDominanceHistory ||
            []
          ).slice(0, 200),

        sectorDominanceState:
          engineState.sectorDominanceState || engineState.sectorDominationState || null,

        sectorDominanceHistory:
          (
            engineState.sectorDominanceHistory ||
            engineState.sectorDominationHistory ||
            []
          ).slice(0, 200),

        capitalRedistributionState: engineState.capitalRedistributionState || null,
        equityCurveState: engineState.equityCurveState || null,
        drawdownRecoveryState: engineState.drawdownRecoveryState || null,
        adaptiveRiskState: engineState.adaptiveRiskState || null,
        capitalRedistributionHistory:
          (engineState.capitalRedistributionHistory || []).slice(0, 200),

        institutionalRebalanceState: engineState.institutionalRebalanceState || null,
        institutionalRebalanceHistory:
          (engineState.institutionalRebalanceHistory || []).slice(0, 200),

        capitalCompoundingState: engineState.capitalCompoundingState || null,
        capitalCompoundingHistory:
          (engineState.capitalCompoundingHistory || []).slice(0, 200),

        multiTimeframeState: engineState.multiTimeframeState || null,
        multiTimeframeHistory: (engineState.multiTimeframeHistory || []).slice(0, 200),

        statisticalEdgeState: engineState.statisticalEdgeState || null,
        statisticalEdgeHistory: (engineState.statisticalEdgeHistory || []).slice(0, 200),

        statisticalMemoryState: engineState.statisticalMemoryState || {
          updatedAt: null,
          setupHistory: [],
          setupPerformance: {},
          expectancyHistory: [],
          probabilityHistory: [],
        },

        probabilityReinforcementState: engineState.probabilityReinforcementState || {
          updatedAt: null,
          setupTrust: {},
        },

        probabilityReinforcementHistory:
          (engineState.probabilityReinforcementHistory || []).slice(0, 200),

        technicalIntelligenceState: engineState.technicalIntelligenceState || null,
        technicalIntelligenceHistory:
          (engineState.technicalIntelligenceHistory || []).slice(0, 200),

        portfolioOptimizationState: engineState.portfolioOptimizationState || null,
        portfolioOptimizationHistory:
          (engineState.portfolioOptimizationHistory || []).slice(0, 200),

        earningsIntelligenceState: engineState.earningsIntelligenceState || null,
        earningsIntelligenceHistory:
          (engineState.earningsIntelligenceHistory || []).slice(0, 200),

        competitiveAdvantageState: engineState.competitiveAdvantageState || null,
        competitiveAdvantageHistory:
          (engineState.competitiveAdvantageHistory || []).slice(0, 200),

        dividendCompoundingState: engineState.dividendCompoundingState || null,
        dividendCompoundingHistory:
          (engineState.dividendCompoundingHistory || []).slice(0, 200),

        dcfValuationState: engineState.dcfValuationState || null,
        dcfValuationHistory: (engineState.dcfValuationHistory || []).slice(0, 200),

        institutionalOrchestratorState: engineState.institutionalOrchestratorState || null,
        institutionalOrchestratorHistory:
          (engineState.institutionalOrchestratorHistory || []).slice(0, 200),

        macroRiskState: engineState.macroRiskState || null,
        macroRiskHistory: (engineState.macroRiskHistory || []).slice(0, 200),

        autonomousTradingSystemState: engineState.autonomousTradingSystemState || null,
        autonomousTradingSystemHistory:
          (engineState.autonomousTradingSystemHistory || []).slice(0, 200),

        executionIntelligenceState: engineState.executionIntelligenceState || null,
        executionIntelligenceHistory:
          (engineState.executionIntelligenceHistory || []).slice(0, 200),

        institutionalExecutionLayerState:
          engineState.institutionalExecutionLayerState || null,
        institutionalExecutionLayerHistory:
          (engineState.institutionalExecutionLayerHistory || []).slice(0, 200),

        reinforcementWeightState: engineState.reinforcementWeightState || null,
        reinforcementWeightHistory:
          (engineState.reinforcementWeightHistory || []).slice(0, 200),

        selfOptimizationState: engineState.selfOptimizationState || null,
        selfOptimizationHistory: (engineState.selfOptimizationHistory || []).slice(0, 200),

        marketCycleIntelligenceState: engineState.marketCycleIntelligenceState || null,
        marketCycleIntelligenceHistory:
          (engineState.marketCycleIntelligenceHistory || []).slice(0, 200),

        autonomousMarketIntelligenceState:
          engineState.autonomousMarketIntelligenceState || null,
        autonomousMarketIntelligenceHistory:
          (engineState.autonomousMarketIntelligenceHistory || []).slice(0, 200),

        marketPersonalityMemory: engineState.marketPersonalityMemory || {},
        recurringSetupMemory: engineState.recurringSetupMemory || {},

        liquidityIntelligenceState: engineState.liquidityIntelligenceState || null,
        liquidityIntelligenceHistory:
          (engineState.liquidityIntelligenceHistory || []).slice(0, 200),

        correlationIntelligenceState: engineState.correlationIntelligenceState || null,
        correlationIntelligenceHistory:
          (engineState.correlationIntelligenceHistory || []).slice(0, 200),

        portfolioGovernorState: engineState.portfolioGovernorState || null,
        portfolioGovernorHistory:
          (engineState.portfolioGovernorHistory || []).slice(0, 200),

        autonomousCapitalRotationState:
          engineState.autonomousCapitalRotationState || null,
        autonomousCapitalRotationHistory:
          (engineState.autonomousCapitalRotationHistory || []).slice(0, 200),

        signalQualityHistory: (engineState.signalQualityHistory || []).slice(0, 200),
        marketBreadthHistory: (engineState.marketBreadthHistory || []).slice(0, 200),
        marketMomentumHistory: (engineState.marketMomentumHistory || []).slice(0, 200),
        marketVolatilityHistory:
          (engineState.marketVolatilityHistory || []).slice(0, 200),
        institutionalExposureHistory:
          (engineState.institutionalExposureHistory || []).slice(0, 200),

        marketCrashProtectionState: engineState.marketCrashProtectionState || null,
        marketCrashProtectionHistory:
          (engineState.marketCrashProtectionHistory || []).slice(0, 200),

        selfHealingScanState: engineState.selfHealingScanState || null,
        selfHealingScanHistory: (engineState.selfHealingScanHistory || []).slice(0, 200),

        liveAiPerformanceState: engineState.liveAiPerformanceState || null,
        liveAiPerformanceHistory:
          (engineState.liveAiPerformanceHistory || []).slice(0, 200),

        tradeJournalState: engineState.tradeJournalState || {},
        tradeJournalOpenEntries: engineState.tradeJournalOpenEntries || {},
        tradeJournalHistory: (engineState.tradeJournalHistory || []).slice(0, 100),

        strategyPerformanceState: engineState.strategyPerformanceState || {},
        regimePerformanceState: engineState.regimePerformanceState || {},
        sectorPerformanceState: engineState.sectorPerformanceState || {},
        confirmationPerformanceState: engineState.confirmationPerformanceState || {},

        scanFailureCount: engineState.scanFailureCount || 0,
        lastScanRecoveryAt: engineState.lastScanRecoveryAt || null,

        aiDecisionHistory: (engineState.aiDecisionHistory || []).slice(0, 100),

        institutionalDashboardSnapshots:
          (engineState.institutionalDashboardSnapshots || []).slice(0, 50),

        lastSignals: (engineState.lastSignals || []).slice(0, 50),
        topSignals: (engineState.topSignals || []).slice(0, 50),
        lastStockSignals: (engineState.lastStockSignals || []).slice(0, 50),
        topStockSignals: (engineState.topStockSignals || []).slice(0, 50),
        lastCryptoSignals: (engineState.lastCryptoSignals || []).slice(0, 50),
        topCryptoSignals: (engineState.topCryptoSignals || []).slice(0, 50),

        stockScoreOutcomeState: engineState.stockScoreOutcomeState || null,
        stockScoreOutcomeSummary: engineState.stockScoreOutcomeSummary || {},
        stockScoreOutcomeFollowupState:
          engineState.stockScoreOutcomeFollowupState || null,
        stockScoreOutcomeLearning: engineState.stockScoreOutcomeLearning || null,
        quietCandidateOutcomeState:
          engineState.quietCandidateOutcomeState || null,
        quietCandidateOutcomeLearning:
          engineState.quietCandidateOutcomeLearning || { stock: null, crypto: null },
        cryptoQuietDiscoveryState:
          engineState.cryptoQuietDiscoveryState || null,

        liveMarketMemory: engineState.liveMarketMemory || {},
        liveEarlyMoverSymbols: engineState.liveEarlyMoverSymbols || [],
        liveEarlyMoverRefreshState: engineState.liveEarlyMoverRefreshState || null,

        polygonLiveStreamState: engineState.polygonLiveStreamState || null,
        fastRunnerEngineState: engineState.fastRunnerEngineState || null,
        fastRunnerCandidates: (engineState.fastRunnerCandidates || []).slice(0, 50),

        quickInstitutionalGateState: engineState.quickInstitutionalGateState || null,
        quickInstitutionalCandidates:
          (engineState.quickInstitutionalCandidates || []).slice(0, 50),

        liveStarterBuyGateState: engineState.liveStarterBuyGateState || null,
        liveStarterBuyHistory: (engineState.liveStarterBuyHistory || []).slice(0, 100),

        livePositionManagementState: engineState.livePositionManagementState || null,
        livePositionManagementHistory:
          (engineState.livePositionManagementHistory || []).slice(0, 100),

        liveScaleInState: engineState.liveScaleInState || null,
        liveScaleInHistory: (engineState.liveScaleInHistory || []).slice(0, 100),

        fullBrainFastSyncState: engineState.fullBrainFastSyncState || null,
        fullBrainFastSyncHistory:
          (engineState.fullBrainFastSyncHistory || []).slice(0, 100),

        deepIntelligenceSyncState: engineState.deepIntelligenceSyncState || null,
        deepIntelligenceSyncHistory:
          (engineState.deepIntelligenceSyncHistory || []).slice(0, 100),

        liveSchedulerState: engineState.liveSchedulerState || null,

        recentOrders: (engineState.recentOrders || []).slice(0, 100),
        failedOrders: (engineState.failedOrders || []).slice(0, 100),
        skippedSymbols: (engineState.skippedSymbols || []).slice(0, 150),

        lastScanAt: engineState.lastScanAt,
        lastHeartbeatAt: engineState.lastHeartbeatAt,
        lastTickStartedAt: engineState.lastTickStartedAt,
        lastTickDurationMs: engineState.lastTickDurationMs,
        lastSuccessfulCycleAt: engineState.lastSuccessfulCycleAt,
        lastEngineStopReason: engineState.lastEngineStopReason,
        totalEngineTicks: engineState.totalEngineTicks,

        marketOpen: engineState.marketOpen,
        marketStressLevel: engineState.marketStressLevel,
        marketMomentumScore: engineState.marketMomentumScore,
        marketVolatility: engineState.marketVolatility,
        marketBreadth: engineState.marketBreadth,
        marketRegime: engineState.marketRegime,
        institutionalExposureMode: engineState.institutionalExposureMode,

        engineFreezeDetected: engineState.engineFreezeDetected,
        engineFreezeCount: engineState.engineFreezeCount,

        phase20AutonomousOrchestrationState:
          engineState.phase20AutonomousOrchestrationState || null,
        phase20AutonomousOrchestrationHistory:
          (engineState.phase20AutonomousOrchestrationHistory || []).slice(0, 200),

        crossEngineMemoryState: engineState.crossEngineMemoryState || null,
        crossEngineMemoryHistory:
          (engineState.crossEngineMemoryHistory || []).slice(0, 200),

        adaptiveExecutionTimingState: engineState.adaptiveExecutionTimingState || null,
        adaptiveExecutionTimingHistory:
          (engineState.adaptiveExecutionTimingHistory || []).slice(0, 200),

        phase21AutonomousBrainState: engineState.phase21AutonomousBrainState || null,

        premarketMomentumState: engineState.premarketMomentumState || null,
        premarketMomentumHistory:
          (engineState.premarketMomentumHistory || []).slice(0, 200),

        premarketDominanceState: engineState.premarketDominanceState || null,
        premarketDominanceHistory:
          (engineState.premarketDominanceHistory || []).slice(0, 200),
        boundedQuietDiscoveryState: engineState.boundedQuietDiscoveryState || null,
        boundedQuietDiscoveryHistory:
          (engineState.boundedQuietDiscoveryHistory || []).slice(0, 30),

        morningStrikeState: engineState.morningStrikeState || null,
        morningStrikeHistory: (engineState.morningStrikeHistory || []).slice(0, 200),
        morningTradesToday: engineState.morningTradesToday || 0,
        lastMorningTradeDateKey: engineState.lastMorningTradeDateKey || null,
        liveTradeLimitState: engineState.liveTradeLimitState || {
          dateKey: null,
          intradayStockEntriesToday: 0,
          positionIntents: {},
        },

        continuationHoldState: engineState.continuationHoldState || null,
        continuationHoldHistory:
          (engineState.continuationHoldHistory || []).slice(0, 200),
        activeContinuationHoldSymbols: engineState.activeContinuationHoldSymbols || [],

        smartExitIntelligenceState: engineState.smartExitIntelligenceState || null,
        smartExitIntelligenceHistory:
          (engineState.smartExitIntelligenceHistory || []).slice(0, 200),

        institutionalExitOrchestratorState:
          engineState.institutionalExitOrchestratorState || null,
        institutionalExitOrchestratorHistory:
          (engineState.institutionalExitOrchestratorHistory || []).slice(0, 200),

        institutionalReloadState: engineState.institutionalReloadState || null,
        institutionalReloadHistory:
          (engineState.institutionalReloadHistory || []).slice(0, 200),

        adaptiveOvernightHoldState: engineState.adaptiveOvernightHoldState || null,
        adaptiveOvernightHoldHistory:
          (engineState.adaptiveOvernightHoldHistory || []).slice(0, 200),

        smartSwingConversionState: engineState.smartSwingConversionState || null,
        smartSwingConversionHistory:
          (engineState.smartSwingConversionHistory || []).slice(0, 200),

        exitParliamentState: engineState.exitParliamentState || null,
        exitParliamentHistory: (engineState.exitParliamentHistory || []).slice(0, 200),

        explosiveRunnerState: engineState.explosiveRunnerState || null,
        explosiveRunnerHoldState: engineState.explosiveRunnerHoldState || null,
        explosiveRunnerHoldHistory:
          (engineState.explosiveRunnerHoldHistory || []).slice(0, 200),
        explosiveRunnerHistory: (engineState.explosiveRunnerHistory || []).slice(0, 200),

        adaptiveRunnerLearningState: engineState.adaptiveRunnerLearningState || null,
        adaptiveRunnerLearningHistory:
          (engineState.adaptiveRunnerLearningHistory || []).slice(0, 200),
        adaptiveRunnerPatternMemory: engineState.adaptiveRunnerPatternMemory || {},

        multiDayAccumulationState: engineState.multiDayAccumulationState || null,
        multiDayAccumulationHistory:
          (engineState.multiDayAccumulationHistory || []).slice(0, 200),
        multiDayAccumulationMemory: engineState.multiDayAccumulationMemory || {},

        themeMomentumState: engineState.themeMomentumState || null,
        themeMomentumHistory: (engineState.themeMomentumHistory || []).slice(0, 200),

        universeExpansionState: engineState.universeExpansionState || null,
        universeExpansionHistory:
          (engineState.universeExpansionHistory || []).slice(0, 200),

        smartUniverseNarrowingState: engineState.smartUniverseNarrowingState || null,
        smartUniverseNarrowingHistory:
          (engineState.smartUniverseNarrowingHistory || []).slice(0, 200),

        fullInstitutionalAiBrainState:
          engineState.fullInstitutionalAiBrainState || null,
        fullInstitutionalAiBrainHistory:
          (engineState.fullInstitutionalAiBrainHistory || []).slice(0, 200),

        autonomousMetaStrategyState: engineState.autonomousMetaStrategyState || null,
        autonomousMetaStrategyHistory:
          (engineState.autonomousMetaStrategyHistory || []).slice(0, 200),

        adaptiveSuppressionBalancerState:
          engineState.adaptiveSuppressionBalancerState || null,
        adaptiveSuppressionBalancerHistory:
          (engineState.adaptiveSuppressionBalancerHistory || []).slice(0, 200),

        phase34AdaptiveAggressionBalancerState:
          engineState.phase34AdaptiveAggressionBalancerState || null,
        phase34AdaptiveAggressionBalancerHistory:
          (engineState.phase34AdaptiveAggressionBalancerHistory || []).slice(0, 200),

        phase38AutonomousCapitalParliamentState:
          engineState.phase38AutonomousCapitalParliamentState || null,
        phase38AutonomousCapitalParliamentHistory:
          (engineState.phase38AutonomousCapitalParliamentHistory || []).slice(0, 200),

        phase41InstitutionalCompressionState:
          engineState.phase41InstitutionalCompressionState || null,
        phase41InstitutionalCompressionHistory:
          (engineState.phase41InstitutionalCompressionHistory || []).slice(0, 200),

        phase40RecursiveRealTimeLearningState:
          engineState.phase40RecursiveRealTimeLearningState || null,
        phase40RecursiveRealTimeLearningHistory:
          (engineState.phase40RecursiveRealTimeLearningHistory || []).slice(0, 200),

        phase39MetaStrategyAiState: engineState.phase39MetaStrategyAiState || null,
        phase39MetaStrategyAiHistory:
          (engineState.phase39MetaStrategyAiHistory || []).slice(0, 200),

        phase37SelfBalancingAiEcosystemState:
          engineState.phase37SelfBalancingAiEcosystemState || null,
        phase37SelfBalancingAiEcosystemHistory:
          (engineState.phase37SelfBalancingAiEcosystemHistory || []).slice(0, 200),

        phase36PredictiveExecutionTimingState:
          engineState.phase36PredictiveExecutionTimingState || null,
        phase36PredictiveExecutionTimingHistory:
          (engineState.phase36PredictiveExecutionTimingHistory || []).slice(0, 200),

        phase35AiGovernanceLayerState:
          engineState.phase35AiGovernanceLayerState || null,
        phase35AiGovernanceLayerHistory:
          (engineState.phase35AiGovernanceLayerHistory || []).slice(0, 200),

        autonomousCapitalPressureState:
          engineState.autonomousCapitalPressureState || null,
        autonomousCapitalPressureHistory:
          (engineState.autonomousCapitalPressureHistory || []).slice(0, 200),

        eliteCapitalConcentrationState:
          engineState.eliteCapitalConcentrationState || null,
        eliteCapitalConcentrationHistory:
          (engineState.eliteCapitalConcentrationHistory || []).slice(0, 200),

        phase42CryptoInstitutionalState:
          engineState.phase42CryptoInstitutionalState || null,
        phase42CryptoInstitutionalHistory:
          (engineState.phase42CryptoInstitutionalHistory || []).slice(0, 200),
        cryptoInstitutionalMemory: engineState.cryptoInstitutionalMemory || {},

        phase43CryptoCapitalRotationState:
          engineState.phase43CryptoCapitalRotationState || null,
        phase43CryptoCapitalRotationHistory:
          (engineState.phase43CryptoCapitalRotationHistory || []).slice(0, 200),
        cryptoCapitalRotationMemory: engineState.cryptoCapitalRotationMemory || {},

        phase44CryptoExecutionTimingState:
          engineState.phase44CryptoExecutionTimingState || null,
        phase44CryptoExecutionTimingHistory:
          (engineState.phase44CryptoExecutionTimingHistory || []).slice(0, 200),
        cryptoExecutionTimingMemory: engineState.cryptoExecutionTimingMemory || {},

        phase45CryptoPositionSizingState:
          engineState.phase45CryptoPositionSizingState || null,
        phase45CryptoPositionSizingHistory:
          (engineState.phase45CryptoPositionSizingHistory || []).slice(0, 200),
        cryptoPositionSizingMemory: engineState.cryptoPositionSizingMemory || {},

        phase46CryptoExitParliamentState:
          engineState.phase46CryptoExitParliamentState || null,
        phase46CryptoExitParliamentHistory:
          (engineState.phase46CryptoExitParliamentHistory || []).slice(0, 200),
        cryptoExitParliamentMemory: engineState.cryptoExitParliamentMemory || {},

        phase47CryptoLiquiditySweepState:
          engineState.phase47CryptoLiquiditySweepState || null,
        phase47CryptoLiquiditySweepHistory:
          (engineState.phase47CryptoLiquiditySweepHistory || []).slice(0, 200),
        cryptoLiquiditySweepMemory: engineState.cryptoLiquiditySweepMemory || {},

        phase48CrossMarketCorrelationState:
          engineState.phase48CrossMarketCorrelationState || null,
        phase48CrossMarketCorrelationHistory:
          (engineState.phase48CrossMarketCorrelationHistory || []).slice(0, 200),
        crossMarketCorrelationMemory: engineState.crossMarketCorrelationMemory || {},

        phase49StablecoinFlowState: engineState.phase49StablecoinFlowState || null,
        phase49StablecoinFlowHistory:
          (engineState.phase49StablecoinFlowHistory || []).slice(0, 200),
        stablecoinFlowMemory: engineState.stablecoinFlowMemory || {},

        phase50WhaleSmartMoneyState:
          engineState.phase50WhaleSmartMoneyState || null,
        phase50WhaleSmartMoneyHistory:
          (engineState.phase50WhaleSmartMoneyHistory || []).slice(0, 200),
        whaleSmartMoneyMemory: engineState.whaleSmartMoneyMemory || {},

        phase51MultiTimeframeCryptoState:
          engineState.phase51MultiTimeframeCryptoState || null,
        phase51MultiTimeframeCryptoHistory:
          (engineState.phase51MultiTimeframeCryptoHistory || []).slice(0, 200),
        multiTimeframeCryptoMemory: engineState.multiTimeframeCryptoMemory || {},

        phase52CryptoStrategySelectorState:
          engineState.phase52CryptoStrategySelectorState ||
          engineState.autonomousCryptoStrategySelectorState ||
          null,

        phase52CryptoStrategySelectorHistory:
          (
            engineState.phase52CryptoStrategySelectorHistory ||
            engineState.autonomousCryptoStrategySelectorHistory ||
            []
          ).slice(0, 200),

        cryptoStrategySelectorMemory: engineState.cryptoStrategySelectorMemory || {},

        autonomousCryptoStrategySelectorState:
          engineState.autonomousCryptoStrategySelectorState ||
          engineState.phase52CryptoStrategySelectorState ||
          null,

        autonomousCryptoStrategySelectorHistory:
          (
            engineState.autonomousCryptoStrategySelectorHistory ||
            engineState.phase52CryptoStrategySelectorHistory ||
            []
          ).slice(0, 200),

        cryptoReinforcementLearningState:
          engineState.cryptoReinforcementLearningState || null,
        cryptoReinforcementLearningHistory:
          (engineState.cryptoReinforcementLearningHistory || []).slice(0, 200),

        globalRiskOffDefenseState: engineState.globalRiskOffDefenseState || null,
        globalRiskOffDefenseHistory:
          (engineState.globalRiskOffDefenseHistory || []).slice(0, 200),

        unifiedInstitutionalOrchestratorState:
          engineState.unifiedInstitutionalOrchestratorState || null,
        unifiedInstitutionalOrchestratorHistory:
          (engineState.unifiedInstitutionalOrchestratorHistory || []).slice(0, 200),

        profitVelocityGovernorState: engineState.profitVelocityGovernorState || null,
        profitVelocityGovernorHistory:
          (engineState.profitVelocityGovernorHistory || []).slice(0, 200),

        phase63StrategyEvolutionState:
          engineState.phase63StrategyEvolutionState || null,
        phase63StrategyEvolutionHistory:
          (engineState.phase63StrategyEvolutionHistory || []).slice(0, 200),
        phase63StrategyEvolutionMemory: engineState.phase63StrategyEvolutionMemory || {},

        phase62MarketPersonalityState:
          engineState.phase62MarketPersonalityState || null,
        phase62MarketPersonalityHistory:
          (engineState.phase62MarketPersonalityHistory || []).slice(0, 200),
        phase62MarketPersonalityMemory:
          engineState.phase62MarketPersonalityMemory || {},

        phase61ProfitAggressionState:
          engineState.phase61ProfitAggressionState || null,
        phase61ProfitAggressionHistory:
          (engineState.phase61ProfitAggressionHistory || []).slice(0, 200),
        phase61AggressionMemory: engineState.phase61AggressionMemory || {},

        phase62MarketPersonality: engineState.phase62MarketPersonalityState || null,
        phase61ProfitAggression: engineState.phase61ProfitAggressionState || null,

        phase60AdaptiveExecutionState:
          engineState.phase60AdaptiveExecutionState || null,
        phase60AdaptiveExecutionHistory:
          (engineState.phase60AdaptiveExecutionHistory || []).slice(0, 200),
        phase60ExecutionMemory: engineState.phase60ExecutionMemory || {},

        phase59InstitutionalOrderFlowState:
          engineState.phase59InstitutionalOrderFlowState || null,
        phase59InstitutionalOrderFlowHistory:
          (engineState.phase59InstitutionalOrderFlowHistory || []).slice(0, 200),
        phase59OrderFlowMemory: engineState.phase59OrderFlowMemory || {},

        executionStyleMemoryState: engineState.executionStyleMemoryState || {},
        executionStyleMemoryHistory:
          (engineState.executionStyleMemoryHistory || []).slice(0, 300),

        archetypeMemoryState: engineState.archetypeMemoryState || {},
        archetypeMemoryHistory: (engineState.archetypeMemoryHistory || []).slice(0, 300),

        autonomousHedgeFundLayerState:
          engineState.autonomousHedgeFundLayerState || null,
        autonomousHedgeFundLayerHistory:
          (engineState.autonomousHedgeFundLayerHistory || []).slice(0, 300),

        liquiditySweepTrapState: engineState.liquiditySweepTrapState || null,
        liquiditySweepTrapHistory:
          (engineState.liquiditySweepTrapHistory || []).slice(0, 300),

        autonomousMetaReinforcementState:
          engineState.autonomousMetaReinforcementState || null,
        autonomousMetaReinforcementHistory:
          (engineState.autonomousMetaReinforcementHistory || []).slice(0, 300),

        aiParliamentVotingState: engineState.aiParliamentVotingState || null,
        aiParliamentVotingHistory:
          (engineState.aiParliamentVotingHistory || []).slice(0, 300),

        liveMomentumMutationState: engineState.liveMomentumMutationState || null,
        liveMomentumMutationHistory:
          (engineState.liveMomentumMutationHistory || []).slice(0, 300),

        dynamicCapitalParliamentState:
          engineState.dynamicCapitalParliamentState || null,
        dynamicCapitalParliamentHistory:
          (engineState.dynamicCapitalParliamentHistory || []).slice(0, 300),

        portfolioEcosystemState: engineState.portfolioEcosystemState || null,
        portfolioEcosystemHistory:
          (engineState.portfolioEcosystemHistory || []).slice(0, 300),

        centralAutonomousDecisionCoreState:
          engineState.centralAutonomousDecisionCoreState || null,
        centralAutonomousDecisionCoreHistory:
          (engineState.centralAutonomousDecisionCoreHistory || []).slice(0, 200),

        finalDashboardSignalSyncState:
          engineState.finalDashboardSignalSyncState || null,
        finalDashboardSignalSyncHistory:
          (engineState.finalDashboardSignalSyncHistory || []).slice(0, 200),

        phase57EliteOverrideState: engineState.phase57EliteOverrideState || null,
        phase57EliteOverrideHistory:
          (engineState.phase57EliteOverrideHistory || []).slice(0, 200),

        phase572EliteDiscoveryState:
          engineState.phase572EliteDiscoveryState || null,
        phase572EliteDiscoveryHistory:
          (engineState.phase572EliteDiscoveryHistory || []).slice(0, 200),

        pyramidScalingState: engineState.pyramidScalingState || null,
        pyramidScalingHistory: (engineState.pyramidScalingHistory || []).slice(0, 200),
        pyramidAddsBySymbol: engineState.pyramidAddsBySymbol || {},

        preMoverDiscoveryState: engineState.preMoverDiscoveryState || null,
        preMoverDiscoveryHistory:
          (engineState.preMoverDiscoveryHistory || []).slice(0, 200),
        preMoverDiscoveryMemory: engineState.preMoverDiscoveryMemory || {},

        pendingExits: engineState.pendingExits || [],
      };

      safeState.liveMarketMemory = {};
      safeState.liveQuoteCache = {};
      safeState.institutionalDashboardSnapshots = [];
      safeState.analyticsSnapshots = [];
      safeState.aiDecisionHistory = (safeState.aiDecisionHistory || []).slice(0, 25);
      safeState.signalHistory = (safeState.signalHistory || []).slice(0, 50);
      safeState.marketRegimeHistory =
        (safeState.marketRegimeHistory || []).slice(0, 50);
      safeState.recentOrders = (safeState.recentOrders || []).slice(0, 50);
      safeState.failedOrders = (safeState.failedOrders || []).slice(0, 50);
      safeState.skippedSymbols = (safeState.skippedSymbols || []).slice(0, 50);

      const compactSafeState = pruneEngineState(
        compactPersistedEngineStateSnapshot(safeState)
      );

      pendingEngineStateSnapshot = compactSafeState;
      pendingEngineStateReason = reason;

      if (!engineStateSaveTimer) {
        engineStateSaveTimer = setTimeoutFn(() => {
          engineStateSaveTimer = null;
          void flushEngineStateSave();
        }, saveDelayMs);
      }

      return compactSafeState;
    } catch (err) {
      console.error("Could not save engine-state.json:", err.message);
      return null;
    }
  }

  return {
    saveEngineState,
    flushEngineStateSave,
    flushStateToFile: flushEngineStateSave,
    getPendingEngineStateReason: () => pendingEngineStateReason,
    getSaveStatus: () => ({
      writeInProgress: Boolean(stateWritePromise),
      saveScheduled: Boolean(engineStateSaveTimer),
      pendingSnapshot: Boolean(pendingEngineStateSnapshot),
      completedWriteCount,
      lastWriteError,
    }),
  };
}
