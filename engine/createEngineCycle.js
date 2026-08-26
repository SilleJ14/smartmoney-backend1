export function createEngineCycle(dependencies) {
  const {
    CONFIG,
    applyCrossMarketCorrelationToSignals,
    applyCryptoCapitalRotationToSignals,
    applyCryptoExecutionTimingToSignals,
    applyCryptoExitStrategyToSignals,
    applyCryptoLiquiditySweepToSignals,
    applyCryptoPositionSizingToSignals,
    applyInstitutionalSectorDominance,
    applyMultiTimeframeCryptoToSignals,
    applyStablecoinFlowToSignals,
    applyWhaleSmartMoneyToSignals,
    autoBuyCryptoSignals,
    autoBuySignals,
    autoCloseCryptoBeforeMarketOpen,
    autoExitCryptoPositions,
    autoExitPositions,
    broadcastTapeEvent,
    buildInstitutionalDashboardPayload,
    buildLiveSignalPushPayload,
    buildStrategyExecutionPlan,
    buildTopAiBrains,
    calculateAdaptiveExecutionTimingIntelligence,
    calculateAdaptiveMarketCycleIntelligence,
    calculateAiMarketCrashProtectionEngine,
    calculateAiPortfolioManagerDecision,
    calculateAiSectorRotationEngine,
    calculateAiSelfOptimizationLayer,
    calculateAutonomousHedgeFundLayer,
    calculateAutonomousMetaReinforcement,
    calculateAutonomousPortfolioGovernor,
    calculateBlackRockPortfolioOptimizer,
    calculateBridgewaterMacroRiskEngine,
    calculateCentralAutonomousDecisionCore,
    calculateCorrelationIntelligenceEngine,
    calculateCrossEngineMemoryEvolution,
    calculateCrossMarketCorrelation,
    calculateCryptoCapitalRotation,
    calculateCryptoInstitutionalSignal,
    calculateCryptoReinforcementLearning,
    calculateCryptoSignalRealismEngine,
    calculateCryptoStrategySelector,
    calculateDynamicCapitalParliament,
    calculateFinalMasterDecisionProfile,
    calculateFinalPositionSizingReconciliation,
    calculateFullInstitutionalAiBrain,
    calculateFullInstitutionalAutonomousTradingSystem,
    calculateGlobalRiskDefense,
    calculateInstitutionalAiPortfolioOrchestrator,
    calculateInstitutionalExecutionIntelligence,
    calculateInstitutionalExecutionPlan,
    calculateInstitutionalRebalanceIntelligence,
    calculateInstitutionalSectorDominanceEngine,
    calculateLiquidityIntelligenceEngine,
    calculateLiquiditySweepTrapIntelligence,
    calculateLiveAiPerformanceAnalyticsEngine,
    calculateLiveMomentumMutation,
    calculateMarketPhase,
    calculateMultiTimeframeConfirmationEngine,
    calculatePenaltyCompressionAndEliteOverride,
    calculatePhase20AsyncMultiAgentOrchestration,
    calculatePhase21AutonomousInstitutionalBrain,
    calculatePhase59InstitutionalOrderFlowIntelligence,
    calculatePhase60AdaptiveExecutionAlgorithms,
    calculatePhase61ProfitAggressionAI,
    calculatePhase62MarketPersonalityMemory,
    calculatePhase63StrategyEvolutionEngine,
    calculatePortfolioEcosystemIntelligence,
    calculateProfitVelocity,
    calculateRegimeDominance,
    calculateReinforcementLearningWeightEngine,
    calculateSelfHealingScanRecoveryEngine,
    calculateSmartCapitalCompoundingEngine,
    calculateSmartCapitalRedistributionEngine,
    calculateStablecoinFlowPressure,
    calculateStockOutcomeLearning,
    calculateUnifiedOrchestrator,
    checkDailyLossAndProfitLock,
    clampScore,
    detectMarketRegime,
    emitSignalTapeTransitions,
    emitSystemRiskTapeState,
    engineState,
    evaluateStockTradeCandidate,
    executePendingExits,
    flattenStocksAndCryptoBeforeMarketClose,
    getAccount,
    getAlpacaKeys,
    getBotOwnedSymbols,
    getClock,
    getEffectiveTradingMode,
    getEnabledStrategyModes,
    getPositions,
    getMemoryGuardState,
    getDueStockOutcomeSymbols,
    getStockOutcomeFollowupQuotes,
    normalizeSymbol,
    pushLiveSignalUpdate,
    recordOrder,
    refreshEarlyMoversThenPolygonSubscriptions,
    refreshFinnhubLiveSubscriptions,
    refreshPolygonLiveSubscriptions,
    resetDailySafetyStateIfNewDay,
    runFastRunnerEngine,
    runFullBrainFastSync,
    runLiveStarterBuyGate,
    runQuickInstitutionalGate,
    saveEngineState,
    scanCryptoMarket,
    scanMarket,
    selectSmartTradingMode,
    syncFinalInstitutionalDashboardSignals,
    syncSignalObjectsBySymbol,
    updateCryptoExecutionTimingState,
    updateCryptoExitStrategyState,
    updateCryptoInstitutionalState,
    updateCryptoLiquiditySweepState,
    updateCryptoPositionSizingState,
    updateInstitutionalWatchlist,
    updateMultiTimeframeCryptoState,
    updateQuietCandidateOutcomes,
    updateStockScoreOutcomes,
    updateWhaleSmartMoneyState,
    getRuntime,
  } = dependencies;

  function recordCryptoScoreObservation(signal, phase, adjustment, reason) {
    signal.cryptoScoreObservations = signal.cryptoScoreObservations || {};
    signal.cryptoScoreObservations[phase] = {
      adjustment: Number(adjustment || 0),
      reason,
      appliedToDecisionScore: false,
    };
  }

  async function executeEngineCycleBody() {
    const { TRADING_MODE, autoTradingEnabled, ENABLE_POLYGON_WEBSOCKET, FINNHUB_API_KEY, POLYGON_API_KEY } = getRuntime();
      const { key, secret } = getAlpacaKeys();
      if (!key || !secret) {
        throw new Error("Missing Alpaca API keys in environment variables");
      }
      if (!POLYGON_API_KEY && !FINNHUB_API_KEY) {
        throw new Error("Missing market data API key: set POLYGON_API_KEY or FINNHUB_API_KEY");
      }
      const account = await getAccount();
      resetDailySafetyStateIfNewDay(account);
      const positions = await getPositions();
      const aiOwnedSymbols = await getBotOwnedSymbols();
      const managedPositions = positions.filter((position) =>
        aiOwnedSymbols.has(normalizeSymbol(position.symbol)) ||
        engineState.aiManagedSymbols?.includes(normalizeSymbol(position.symbol))
      );
      engineState.cachedAccount = account;
      engineState.cachedPositions = positions;
      const clock = await getClock();
      const marketOpen = Boolean(clock.is_open);
      let effectiveMode = getEffectiveTradingMode(marketOpen);
      const todayKey = new Date().toISOString().slice(0, 10);
      if (engineState.lastTradingDayKey !== todayKey) {
        engineState.lastTradingDayKey = todayKey;
        engineState.stockTradingStoppedForDay = false;
        engineState.cryptoTradingStoppedForDay = false;
        recordOrder("TRADING_FLAGS_RESET_FOR_NEW_DAY", "SYSTEM", {
          todayKey,
        });
      }
      engineState.effectiveMode = effectiveMode;
      engineState.marketOpen = marketOpen;
      const openingBellJustTriggered =
        engineState.lastMarketOpen === false && marketOpen === true;
      if (openingBellJustTriggered) {
        engineState.openingBellTriggeredAt = Date.now();
        recordOrder("OPENING_BELL_TRIGGER_DETECTED", "MARKET", {
          openingBellTriggeredAt: new Date(
            engineState.openingBellTriggeredAt
          ).toISOString(),
          preparedFastRunnerCount:
            engineState.fastRunnerCandidates?.length || 0,
          preparedQuickGateCount:
            engineState.quickInstitutionalCandidates?.length || 0,
        });
        await runFastRunnerEngine();
        await runQuickInstitutionalGate();
        await runFullBrainFastSync();
        await runLiveStarterBuyGate();
        saveEngineState("OPENING_BELL_FAST_BUY_TRIGGER");
      }
      if (engineState.lastMarketOpen === true && marketOpen === false) {
        engineState.marketClosedAt = Date.now();
        engineState.cryptoTradingStoppedForDay = false;
        recordOrder("MARKET_CLOSED_DETECTED", "MARKET", {
          marketClosedAt: new Date(engineState.marketClosedAt).toISOString(),
          cryptoTradingStoppedForDay: false,
        });
      }
      engineState.lastMarketOpen = marketOpen;
      console.log("SMART MODE:", {
        selected: TRADING_MODE,
        effective: effectiveMode,
        marketOpen,
      });
      const riskLocked = await checkDailyLossAndProfitLock(account, marketOpen);
      if (marketOpen) {
        await executePendingExits();
      }
      const tradingStoppedForDay =
        await flattenStocksAndCryptoBeforeMarketClose(clock);
      await autoCloseCryptoBeforeMarketOpen(clock);
      await autoExitPositions(marketOpen);
      const { stockModeEnabled, cryptoModeEnabled } =
        getEnabledStrategyModes(effectiveMode);
      if (cryptoModeEnabled) {
        await autoExitCryptoPositions();
      }
      let stockSignals = [];
      let cryptoSignals = [];
      const memoryGuard = typeof getMemoryGuardState === "function"
        ? getMemoryGuardState()
        : { shouldPauseHeavyWork: false };
      engineState.memoryGuardState = {
        ...memoryGuard,
        checkedAt: new Date().toISOString(),
      };
      if (memoryGuard.shouldPauseHeavyWork) {
        engineState.lastEngineStopReason = "MEMORY_GUARD_HEAVY_SCAN_SKIPPED";
        engineState.lastHeartbeatAt = new Date().toISOString();
        return;
      }
      const scanStartedAt = Date.now();
      if (cryptoModeEnabled) {
        cryptoSignals = await scanCryptoMarket();
        const selectedQuietCrypto = Array.isArray(
          engineState.cryptoQuietDiscoveryState?.topCandidates
        )
          ? engineState.cryptoQuietDiscoveryState.topCandidates
          : [];
        if (typeof updateQuietCandidateOutcomes === "function") {
          engineState.quietCandidateOutcomeState = updateQuietCandidateOutcomes(
            engineState.quietCandidateOutcomeState,
            selectedQuietCrypto,
            cryptoSignals,
            {
              assetClass: "crypto",
              dayKey: new Date().toISOString().slice(0, 10),
              tradedSymbols: engineState.aiManagedSymbols || [],
            }
          );
          engineState.quietCandidateOutcomeLearning =
            engineState.quietCandidateOutcomeState.learning;
        }
      }
      if (stockModeEnabled) {
        stockSignals = await scanMarket();
      }
      recordOrder("PIPELINE_SCAN_COMPLETED", "ALL", {
        tradingMode: TRADING_MODE,
        effectiveMode,
        stockModeEnabled,
        scannedStockSignals: stockSignals.length,
        cryptoModeEnabled,
        scannedCryptoSignals: cryptoSignals.length,
      });
      engineState.marketBreadth = {
        advancing: stockSignals.filter(
          (s) => Number(s.percentChange || 0) > 0
        ).length,
        declining: stockSignals.filter(
          (s) => Number(s.percentChange || 0) < 0
        ).length,
      };
      engineState.marketStressLevel =
        stockSignals.filter(
          (s) => Number(s.percentChange || 0) <= -10
        ).length;
      engineState.marketMomentumScore =
        stockSignals.reduce(
          (sum, s) =>
            sum + Number(s.percentChange || 0),
          0
        ) / Math.max(1, stockSignals.length);
      engineState.marketVolatility =
        stockSignals.reduce(
          (sum, s) =>
            sum + Math.abs(Number(s.percentChange || 0)),
          0
        ) / Math.max(1, stockSignals.length);
      engineState.institutionalExposureMode =
        engineState.marketVolatility >= 12
          ? "DEFENSIVE"
          : engineState.marketMomentumScore >= 8
            ? "AGGRESSIVE"
            : "NORMAL";
      stockSignals.forEach((signal) => {
        signal.institutionalGrade =
          signal.score >= 95
            ? "ELITE"
            : signal.score >= 90
              ? "HIGH"
              : signal.score >= 85
                ? "GOOD"
                : "NORMAL";
      });
      for (const signal of cryptoSignals) {
        signal.rawCryptoScore = Number(
          signal.rawCryptoScore ?? signal.scannerScore ?? signal.score ?? 0
        );
        signal.scannerScore = signal.rawCryptoScore;
        const initialCryptoRealism = calculateCryptoSignalRealismEngine(signal);
        signal.cryptoRealism = initialCryptoRealism;
        signal.realismAdjustedScore = initialCryptoRealism.realismScore;
        signal.cryptoEntryScore = initialCryptoRealism.entryQualityScore;
        signal.cryptoRiskPenalty = initialCryptoRealism.cryptoRiskPenalty;
        signal.cryptoScoreTelemetry = {
          version: 1,
          discovery: {
            score: signal.rawCryptoScore,
            source: "crypto_market_scanner",
          },
          entry: {
            score: initialCryptoRealism.entryQualityScore,
            coverage: initialCryptoRealism.coverage,
            penalties: initialCryptoRealism.penaltyComponents,
            missingComponents: initialCryptoRealism.missingComponents,
            gates: initialCryptoRealism.entryBlockReasons,
          },
        };
        const phase42CryptoInstitutional =
          calculateCryptoInstitutionalSignal(signal);
        signal.phase42CryptoInstitutional = phase42CryptoInstitutional;
        signal.cryptoInstitutionalScore =
          phase42CryptoInstitutional.cryptoInstitutionalScore;
        signal.cryptoLiquidityScore =
          phase42CryptoInstitutional.cryptoLiquidityScore;
        signal.cryptoMomentumScore =
          phase42CryptoInstitutional.cryptoMomentumScore;
        signal.cryptoRegime =
          phase42CryptoInstitutional.cryptoRegime;
        if (Number(phase42CryptoInstitutional.scoreBoost || 0) !== 0) {
          recordCryptoScoreObservation(
            signal,
            "phase42",
            Number(phase42CryptoInstitutional.scoreBoost || 0),
            "crypto institutional regime"
          );
        }
        if (phase42CryptoInstitutional.suppressCrypto) {
          signal.qualifiedToBuy = false;
          signal.phase42Suppressed = true;
          signal.phase42SuppressionReason =
            phase42CryptoInstitutional.reason;
        }
      }
      const phase42CryptoInstitutionalState =
        updateCryptoInstitutionalState(cryptoSignals);
      recordOrder("PHASE_42_CRYPTO_INSTITUTIONAL_UPDATED", "CRYPTO", {
        reviewedCount: phase42CryptoInstitutionalState.reviewedCount,
        approvedCount: phase42CryptoInstitutionalState.approvedCount,
        blockedCount: phase42CryptoInstitutionalState.blockedCount,
      });
      const phase43CryptoCapitalRotationState =
        calculateCryptoCapitalRotation(cryptoSignals);
      cryptoSignals = applyCryptoCapitalRotationToSignals(
        cryptoSignals,
        phase43CryptoCapitalRotationState
      );
      recordOrder("PHASE_43_CRYPTO_CAPITAL_ROTATION_UPDATED", "CRYPTO", {
        reviewedCount: phase43CryptoCapitalRotationState.reviewedCount,
        approvedCount: phase43CryptoCapitalRotationState.approvedCount,
        cryptoCapitalMode:
          phase43CryptoCapitalRotationState.cryptoCapitalMode,
        cryptoCapitalMultiplier:
          phase43CryptoCapitalRotationState.cryptoCapitalMultiplier,
      });
      const phase44CryptoExecutionTimingState =
        updateCryptoExecutionTimingState(cryptoSignals);
      cryptoSignals = applyCryptoExecutionTimingToSignals(cryptoSignals);
      recordOrder("PHASE_44_CRYPTO_EXECUTION_TIMING_UPDATED", "CRYPTO", {
        reviewedCount: phase44CryptoExecutionTimingState.reviewedCount,
        executableCount: phase44CryptoExecutionTimingState.executableCount,
        blockedCount: phase44CryptoExecutionTimingState.blockedCount,
        avgExecutionScore:
          phase44CryptoExecutionTimingState.avgExecutionScore,
      });
      const phase45CryptoPositionSizingState =
        updateCryptoPositionSizingState(cryptoSignals);
      cryptoSignals = applyCryptoPositionSizingToSignals(cryptoSignals);
      recordOrder("PHASE_45_CRYPTO_POSITION_SIZING_UPDATED", "CRYPTO", {
        reviewedCount: phase45CryptoPositionSizingState.reviewedCount,
        tradableCount: phase45CryptoPositionSizingState.tradableCount,
        blockedCount: phase45CryptoPositionSizingState.blockedCount,
        avgSizingScore: phase45CryptoPositionSizingState.avgSizingScore,
      });
      const phase46CryptoExitParliamentState =
        updateCryptoExitStrategyState(cryptoSignals);
      cryptoSignals = applyCryptoExitStrategyToSignals(cryptoSignals);
      recordOrder("PHASE_46_CRYPTO_EXIT_PARLIAMENT_UPDATED", "CRYPTO", {
        reviewedCount: phase46CryptoExitParliamentState.reviewedCount,
        runnerCount: phase46CryptoExitParliamentState.runnerCount,
        exitCandidateCount:
          phase46CryptoExitParliamentState.exitCandidateCount,
        avgRunnerStrength:
          phase46CryptoExitParliamentState.avgRunnerStrength,
      });
      const phase47CryptoLiquiditySweepState =
        updateCryptoLiquiditySweepState(cryptoSignals);
      cryptoSignals = applyCryptoLiquiditySweepToSignals(cryptoSignals);
      recordOrder("PHASE_47_CRYPTO_LIQUIDITY_SWEEP_UPDATED", "CRYPTO", {
        reviewedCount: phase47CryptoLiquiditySweepState.reviewedCount,
        confirmedSweepCount:
          phase47CryptoLiquiditySweepState.confirmedSweepCount,
        blockedTrapCount:
          phase47CryptoLiquiditySweepState.blockedTrapCount,
        avgSweepScore: phase47CryptoLiquiditySweepState.avgSweepScore,
      });
      const phase48CrossMarketCorrelationState =
        calculateCrossMarketCorrelation(stockSignals, cryptoSignals);
      cryptoSignals = applyCrossMarketCorrelationToSignals(
        cryptoSignals,
        phase48CrossMarketCorrelationState
      );
      recordOrder("PHASE_48_CROSS_MARKET_CORRELATION_UPDATED", "CRYPTO", {
        stockSignalCount:
          phase48CrossMarketCorrelationState.stockSignalCount,
        cryptoSignalCount:
          phase48CrossMarketCorrelationState.cryptoSignalCount,
        crossMarketMode:
          phase48CrossMarketCorrelationState.crossMarketMode,
        correlationScore:
          phase48CrossMarketCorrelationState.correlationScore,
      });
      const phase49StablecoinFlowState =
        calculateStablecoinFlowPressure(
          cryptoSignals,
          phase48CrossMarketCorrelationState
        );
      cryptoSignals = applyStablecoinFlowToSignals(
        cryptoSignals,
        phase49StablecoinFlowState
      );
      recordOrder("PHASE_49_STABLECOIN_FLOW_UPDATED", "CRYPTO", {
        cryptoSignalCount: phase49StablecoinFlowState.cryptoSignalCount,
        flowMode: phase49StablecoinFlowState.flowMode,
        exchangePressureScore:
          phase49StablecoinFlowState.exchangePressureScore,
        stablecoinDemandProxy:
          phase49StablecoinFlowState.stablecoinDemandProxy,
      });
      const phase50WhaleSmartMoneyState =
        updateWhaleSmartMoneyState(cryptoSignals);
      cryptoSignals = applyWhaleSmartMoneyToSignals(cryptoSignals);
      recordOrder("PHASE_50_WHALE_SMART_MONEY_UPDATED", "CRYPTO", {
        reviewedCount: phase50WhaleSmartMoneyState.reviewedCount,
        accumulationCount: phase50WhaleSmartMoneyState.accumulationCount,
        blockedDistributionCount:
          phase50WhaleSmartMoneyState.blockedDistributionCount,
        avgWhaleScore: phase50WhaleSmartMoneyState.avgWhaleScore,
      });
      const phase51MultiTimeframeCryptoState =
        updateMultiTimeframeCryptoState(cryptoSignals);
      cryptoSignals = applyMultiTimeframeCryptoToSignals(cryptoSignals);
      recordOrder("PHASE_51_MULTI_TIMEFRAME_CRYPTO_UPDATED", "CRYPTO", {
        reviewedCount: phase51MultiTimeframeCryptoState.reviewedCount,
        alignedCount: phase51MultiTimeframeCryptoState.alignedCount,
        blockedConflictCount:
          phase51MultiTimeframeCryptoState.blockedConflictCount,
        avgParliamentScore:
          phase51MultiTimeframeCryptoState.avgParliamentScore,
      });
      let signals = [...stockSignals, ...cryptoSignals];
      const phase59InstitutionalOrderFlow =
        calculatePhase59InstitutionalOrderFlowIntelligence(stockSignals, cryptoSignals);
      engineState.phase59InstitutionalOrderFlowState =
        phase59InstitutionalOrderFlow.state;
      engineState.phase59InstitutionalOrderFlowHistory.unshift(
        phase59InstitutionalOrderFlow.state
      );
      engineState.phase59InstitutionalOrderFlowHistory =
        engineState.phase59InstitutionalOrderFlowHistory.slice(0, 200);
      for (const orderFlow of phase59InstitutionalOrderFlow.analyzedSignals) {
        const matchingSignal = signals.find(
          (signal) =>
            normalizeSymbol(signal.symbol) === normalizeSymbol(orderFlow.symbol)
        );
        if (!matchingSignal) continue;
        matchingSignal.phase59InstitutionalOrderFlow = orderFlow;
        matchingSignal.orderFlowConvictionScore =
          orderFlow.orderFlowConvictionScore;
        matchingSignal.liquidityTrapScore = orderFlow.liquidityTrapScore;
        matchingSignal.exhaustionRiskScore = orderFlow.exhaustionRiskScore;
        matchingSignal.spreadPercent = orderFlow.spreadPercent;
        matchingSignal.score = clampScore(
          Number(matchingSignal.score || 0) *
          Number(orderFlow.orderFlowMultiplier || 1)
        );
        if (orderFlow.shouldBlock) {
          matchingSignal.autoTradeApproved = false;
          matchingSignal.approved = false;
          matchingSignal.decisionLevel =
            "Blocked By Phase 59 Institutional Order Flow";
        }
      }
      recordOrder("PHASE_59_ORDER_FLOW_UPDATED", "MARKET", {
        reviewedCount: phase59InstitutionalOrderFlow.state.reviewedCount,
        eliteFlowCount: phase59InstitutionalOrderFlow.state.eliteFlowCount,
        blockedFlowCount: phase59InstitutionalOrderFlow.state.blockedFlowCount,
        averageOrderFlowScore:
          phase59InstitutionalOrderFlow.state.averageOrderFlowScore,
      });
      for (const signal of signals) {
        const phase60AdaptiveExecution =
          calculatePhase60AdaptiveExecutionAlgorithms(
            signal,
            Number(
              signal.recommendedTradeAmount ||
              signal.recommendedDollarAmount ||
              signal.tradeAmount ||
              0
            )
          );
        signal.phase60AdaptiveExecution = phase60AdaptiveExecution;
        signal.adaptiveExecutionScore =
          phase60AdaptiveExecution.adaptiveExecutionScore;
        signal.executionStyle = phase60AdaptiveExecution.executionStyle;
        signal.executionMultiplier = phase60AdaptiveExecution.executionMultiplier;
        if (phase60AdaptiveExecution.shouldBlockExecution) {
          signal.autoTradeApproved = false;
          signal.approved = false;
          signal.decisionLevel =
            "Blocked By Phase 60 Adaptive Execution";
        }
      }
      const earlyCentralAutonomousDecisionCore =
        calculateCentralAutonomousDecisionCore(stockSignals, cryptoSignals);
      for (const decision of earlyCentralAutonomousDecisionCore.rankedDecisions) {
        const matchingSignal = signals.find(
          (signal) =>
            normalizeSymbol(signal.symbol) === normalizeSymbol(decision.symbol)
        );
        if (!matchingSignal) continue;
        matchingSignal.centralAutonomousDecisionCore = decision;
        matchingSignal.finalAutonomousDecisionScore =
          decision.finalDecisionScore;
        if (cryptoSignals.includes(matchingSignal)) {
          matchingSignal.cryptoDecisionScore = decision.finalDecisionScore;
        } else {
          matchingSignal.stockDecisionScore = decision.finalDecisionScore;
        }
        matchingSignal.centralAutonomousAction = decision.action;
        matchingSignal.masterCapitalMultiplier =
          decision.masterCapitalMultiplier;
        matchingSignal.centralCoreExecution = decision.centralCoreExecution;
        matchingSignal.executionSizeMultiplier =
          decision.executionSizeMultiplier;
        matchingSignal.executionStyleTrustAdjustment =
          decision.executionStyleTrustAdjustment;
        matchingSignal.executionStyleTrustMultiplier =
          decision.executionStyleTrustMultiplier;
        matchingSignal.shouldWaitForPullback =
          decision.shouldWaitForPullback;
      }
      const phase61ProfitAggression =
        calculatePhase61ProfitAggressionAI(signals);
      engineState.phase61ProfitAggressionState =
        phase61ProfitAggression.state;
      engineState.phase61ProfitAggressionHistory.unshift(
        phase61ProfitAggression.state
      );
      engineState.phase61ProfitAggressionHistory =
        engineState.phase61ProfitAggressionHistory.slice(0, 200);
      for (const aggression of phase61ProfitAggression.analyzedSignals) {
        const matchingSignal = signals.find(
          (signal) =>
            normalizeSymbol(signal.symbol) === normalizeSymbol(aggression.symbol)
        );
        if (!matchingSignal) continue;
        matchingSignal.phase61ProfitAggression = aggression;
        matchingSignal.profitAggressionScore =
          aggression.profitAggressionScore;
        matchingSignal.profitAggressionMultiplier =
          aggression.aggressionMultiplier;
        matchingSignal.maxAllowedExposurePercent =
          aggression.maxAllowedExposurePercent;
        matchingSignal.allocationMultiplier = Number(
          (
            Number(matchingSignal.allocationMultiplier || 1) *
            Number(aggression.aggressionMultiplier || 1)
          ).toFixed(2)
        );
        if (aggression.shouldBlockAggression) {
          matchingSignal.autoTradeApproved = false;
          matchingSignal.approved = false;
          matchingSignal.decisionLevel =
            "Blocked By Phase 61 Profit Aggression";
        }
      }
      recordOrder("PHASE_61_PROFIT_AGGRESSION_UPDATED", "MARKET", {
        reviewedCount: phase61ProfitAggression.state.reviewedCount,
        aggressiveCount: phase61ProfitAggression.state.aggressiveCount,
        defensiveCount: phase61ProfitAggression.state.defensiveCount,
        averageAggressionScore:
          phase61ProfitAggression.state.averageAggressionScore,
      });
      const phase62MarketPersonality =
        calculatePhase62MarketPersonalityMemory(signals);
      engineState.phase62MarketPersonalityState =
        phase62MarketPersonality.state;
      engineState.phase62MarketPersonalityHistory.unshift(
        phase62MarketPersonality.state
      );
      engineState.phase62MarketPersonalityHistory =
        engineState.phase62MarketPersonalityHistory.slice(0, 200);
      for (const personality of phase62MarketPersonality.analyzedSignals) {
        const matchingSignal = signals.find(
          (signal) =>
            normalizeSymbol(signal.symbol) === normalizeSymbol(personality.symbol)
        );
        if (!matchingSignal) continue;
        matchingSignal.phase62MarketPersonality = personality;
        matchingSignal.personalityFitScore =
          personality.personalityFitScore;
        matchingSignal.personalityMultiplier =
          personality.personalityMultiplier;
        matchingSignal.allocationMultiplier = Number(
          (
            Number(matchingSignal.allocationMultiplier || 1) *
            Number(personality.personalityMultiplier || 1)
          ).toFixed(2)
        );
        if (personality.shouldPersonalityBlock) {
          matchingSignal.autoTradeApproved = false;
          matchingSignal.approved = false;
          matchingSignal.decisionLevel =
            "Blocked By Phase 62 Market Personality";
        }
      }
      recordOrder("PHASE_62_MARKET_PERSONALITY_UPDATED", "MARKET", {
        reviewedCount: phase62MarketPersonality.state.reviewedCount,
        eliteMatchCount: phase62MarketPersonality.state.eliteMatchCount,
        blockedCount: phase62MarketPersonality.state.blockedCount,
        averagePersonalityFit:
          phase62MarketPersonality.state.averagePersonalityFit,
      });
      const phase63StrategyEvolution =
        calculatePhase63StrategyEvolutionEngine(signals);
      engineState.phase63StrategyEvolutionState =
        phase63StrategyEvolution.state;
      engineState.phase63StrategyEvolutionHistory.unshift(
        phase63StrategyEvolution.state
      );
      engineState.phase63StrategyEvolutionHistory =
        engineState.phase63StrategyEvolutionHistory.slice(0, 200);
      for (const evolution of phase63StrategyEvolution.analyzedSignals) {
        const matchingSignal = signals.find(
          (signal) =>
            normalizeSymbol(signal.symbol) === normalizeSymbol(evolution.symbol)
        );
        if (!matchingSignal) continue;
        matchingSignal.phase63StrategyEvolution = evolution;
        matchingSignal.strategyEvolutionScore =
          evolution.strategyEvolutionScore;
        matchingSignal.strategyEvolutionMultiplier =
          evolution.strategyEvolutionMultiplier;
        matchingSignal.evolvedMinScoreOffset =
          evolution.evolvedMinScoreOffset;
        matchingSignal.allocationMultiplier = Number(
          (
            Number(matchingSignal.allocationMultiplier || 1) *
            Number(evolution.strategyEvolutionMultiplier || 1)
          ).toFixed(2)
        );
        if (evolution.shouldStrategyBlock) {
          matchingSignal.autoTradeApproved = false;
          matchingSignal.approved = false;
          matchingSignal.decisionLevel =
            "Blocked By Phase 63 Strategy Evolution";
        }
      }
      recordOrder("PHASE_63_STRATEGY_EVOLUTION_UPDATED", "MARKET", {
        reviewedCount: phase63StrategyEvolution.state.reviewedCount,
        amplifiedCount: phase63StrategyEvolution.state.amplifiedCount,
        suppressedCount: phase63StrategyEvolution.state.suppressedCount,
        averageStrategyEvolution:
          phase63StrategyEvolution.state.averageStrategyEvolution,
      });
      const autonomousCryptoStrategySelector =
        calculateCryptoStrategySelector(cryptoSignals);
      engineState.autonomousCryptoStrategySelectorState =
        autonomousCryptoStrategySelector;
      engineState.phase52CryptoStrategySelectorState =
        autonomousCryptoStrategySelector;
      engineState.autonomousCryptoStrategySelectorHistory.unshift(
        autonomousCryptoStrategySelector
      );
      engineState.phase52CryptoStrategySelectorHistory.unshift(
        autonomousCryptoStrategySelector
      );
      engineState.phase52CryptoStrategySelectorHistory =
        engineState.phase52CryptoStrategySelectorHistory.slice(0, 200);
      engineState.autonomousCryptoStrategySelectorHistory =
        engineState.autonomousCryptoStrategySelectorHistory.slice(0, 200);
      for (const selectedCrypto of autonomousCryptoStrategySelector.selectedCryptoSignals) {
        const matchingSignal = cryptoSignals.find(
          (signal) =>
            normalizeSymbol(signal.symbol) ===
            normalizeSymbol(selectedCrypto.symbol)
        );
        if (!matchingSignal) continue;
        matchingSignal.autonomousCryptoStrategySelector = selectedCrypto;
        matchingSignal.cryptoStrategySelectorScore =
          selectedCrypto.strategyConfidence;
        matchingSignal.selectedCryptoStrategy =
          selectedCrypto.selectedStrategy;
        if (selectedCrypto.shouldBoostCryptoScore) {
          recordCryptoScoreObservation(
            matchingSignal,
            "phase52",
            Number(selectedCrypto.strategyScoreBoost || 0),
            "crypto strategy selector"
          );
        }
        if (selectedCrypto.action === "BLOCK_WEAK_CRYPTO_STRATEGY") {
          matchingSignal.autoTradeApproved = false;
          matchingSignal.decisionLevel = "Blocked Weak Crypto Strategy";
        }
      }
      const cryptoReinforcementLearning =
        calculateCryptoReinforcementLearning(cryptoSignals);
      engineState.cryptoReinforcementLearningState =
        cryptoReinforcementLearning;
      engineState.cryptoReinforcementLearningHistory.unshift(
        cryptoReinforcementLearning
      );
      engineState.cryptoReinforcementLearningHistory =
        engineState.cryptoReinforcementLearningHistory.slice(0, 200);
      for (const reinforcedCrypto of cryptoReinforcementLearning.reinforcedSignals) {
        const matchingSignal = cryptoSignals.find(
          (signal) =>
            normalizeSymbol(signal.symbol) ===
            normalizeSymbol(reinforcedCrypto.symbol)
        );
        if (!matchingSignal) continue;
        matchingSignal.cryptoReinforcementLearning = reinforcedCrypto;
        matchingSignal.cryptoReinforcementScore =
          reinforcedCrypto.reinforcementScore;
        if (reinforcedCrypto.learningAvailable === true) {
          recordCryptoScoreObservation(
            matchingSignal,
            "cryptoReinforcement",
            Number(reinforcedCrypto.learningAdjustment || 0),
            "crypto reinforcement learning"
          );
        }
        if (reinforcedCrypto.shouldSuppressCrypto) {
          matchingSignal.autoTradeApproved = false;
          matchingSignal.decisionLevel =
            "Blocked By Crypto Reinforcement Learning";
        }
      }
      const globalRiskOffDefense =
        calculateGlobalRiskDefense(stockSignals, cryptoSignals);
      engineState.globalRiskOffDefenseState = globalRiskOffDefense;
      engineState.globalRiskOffDefenseHistory.unshift(globalRiskOffDefense);
      engineState.globalRiskOffDefenseHistory =
        engineState.globalRiskOffDefenseHistory.slice(0, 200);
      engineState.globalRiskOffDefenseMode =
        globalRiskOffDefense.defenseMode;
      engineState.globalRiskOffExposureMultiplier =
        globalRiskOffDefense.exposureMultiplier;
      for (const protectedCrypto of globalRiskOffDefense.protectedCryptoSignals) {
        const matchingSignal = cryptoSignals.find(
          (signal) =>
            normalizeSymbol(signal.symbol) === normalizeSymbol(protectedCrypto.symbol)
        );
        if (!matchingSignal) continue;
        matchingSignal.globalRiskOffDefense = protectedCrypto;
        matchingSignal.globalRiskOffScore =
          protectedCrypto.individualRiskScore;
        matchingSignal.globalRiskOffDefenseMode =
          globalRiskOffDefense.defenseMode;
        matchingSignal.globalRiskOffExposureMultiplier =
          globalRiskOffDefense.exposureMultiplier;
        matchingSignal.score = clampScore(
          Number(matchingSignal.score || 0) +
          Number(protectedCrypto.scorePenalty || 0)
        );
        if (protectedCrypto.shouldReduceSize) {
          matchingSignal.cryptoRiskAdjustedSizeMultiplier =
            globalRiskOffDefense.exposureMultiplier;
        }
        if (protectedCrypto.shouldBlock) {
          matchingSignal.autoTradeApproved = false;
          matchingSignal.decisionLevel =
            "Blocked By Global Risk-Off Defense";
        }
      }
      const unifiedInstitutionalOrchestrator =
        calculateUnifiedOrchestrator(stockSignals, cryptoSignals);
      engineState.unifiedInstitutionalOrchestratorState =
        unifiedInstitutionalOrchestrator;
      engineState.unifiedInstitutionalOrchestratorHistory.unshift(
        unifiedInstitutionalOrchestrator
      );
      engineState.unifiedInstitutionalOrchestratorHistory =
        engineState.unifiedInstitutionalOrchestratorHistory.slice(0, 200);
      engineState.unifiedInstitutionalMode =
        unifiedInstitutionalOrchestrator.orchestratorMode;
      engineState.unifiedInstitutionalCapitalMultiplier =
        unifiedInstitutionalOrchestrator.finalCapitalMultiplier;
      for (const orchestrated of unifiedInstitutionalOrchestrator.orchestratedSignals) {
        const matchingSignal = [...stockSignals, ...cryptoSignals].find(
          (signal) =>
            normalizeSymbol(signal.symbol) === normalizeSymbol(orchestrated.symbol)
        );
        if (!matchingSignal) continue;
        matchingSignal.unifiedInstitutionalOrchestrator = orchestrated;
        matchingSignal.finalOrchestratedScore =
          orchestrated.finalOrchestratedScore;
        matchingSignal.unifiedInstitutionalMode =
          unifiedInstitutionalOrchestrator.orchestratorMode;
        matchingSignal.finalCapitalMultiplier =
          unifiedInstitutionalOrchestrator.finalCapitalMultiplier;
        matchingSignal.score = clampScore(
          Number(matchingSignal.score || 0) * 0.85 +
          Number(orchestrated.finalOrchestratedScore || 0) * 0.15
        );
        if (orchestrated.shouldBlock) {
          matchingSignal.autoTradeApproved = false;
          matchingSignal.decisionLevel =
            "Blocked By Unified Institutional Orchestrator";
        }
        if (
          orchestrated.action === "PRIORITY_INSTITUTIONAL_BUY" ||
          orchestrated.action === "APPROVED_INSTITUTIONAL_BUY"
        ) {
          matchingSignal.decisionLevel = orchestrated.action;
        }
      }
      const profitVelocityGovernor =
        calculateProfitVelocity(stockSignals, cryptoSignals);
      engineState.profitVelocityGovernorState = profitVelocityGovernor;
      engineState.profitVelocityGovernorHistory.unshift(profitVelocityGovernor);
      engineState.profitVelocityGovernorHistory =
        engineState.profitVelocityGovernorHistory.slice(0, 200);
      engineState.profitVelocityMode = profitVelocityGovernor.velocityMode;
      engineState.profitVelocityCapitalMultiplier =
        profitVelocityGovernor.velocityCapitalMultiplier;
      for (const governed of profitVelocityGovernor.governedSignals) {
        const matchingSignal = [...stockSignals, ...cryptoSignals].find(
          (signal) =>
            normalizeSymbol(signal.symbol) === normalizeSymbol(governed.symbol)
        );
        if (!matchingSignal) continue;
        matchingSignal.profitVelocityGovernor = governed;
        matchingSignal.profitVelocityScore = governed.finalVelocityScore;
        matchingSignal.profitVelocityMode = profitVelocityGovernor.velocityMode;
        matchingSignal.profitVelocityCapitalMultiplier =
          profitVelocityGovernor.velocityCapitalMultiplier;
        if (governed.shouldReduceSpeed) {
          matchingSignal.autoTradeApproved = false;
          matchingSignal.decisionLevel = "Reduced By Profit Velocity Governor";
        }
        if (governed.shouldAccelerate) {
          matchingSignal.score = clampScore(Number(matchingSignal.score || 0) + 2);
        }
      }
      const portfolioEcosystem =
        calculatePortfolioEcosystemIntelligence(
          signals,
          engineState.cachedPositions || []
        );
      engineState.portfolioEcosystemState =
        portfolioEcosystem.state;
      engineState.portfolioEcosystemHistory.unshift(
        portfolioEcosystem.state
      );
      engineState.portfolioEcosystemHistory =
        engineState.portfolioEcosystemHistory.slice(0, 300);
      for (const ecosystem of portfolioEcosystem.adjustedSignals) {
        const matchingSignal = signals.find(
          (signal) =>
            normalizeSymbol(signal.symbol) === normalizeSymbol(ecosystem.symbol)
        );
        if (!matchingSignal) continue;
        matchingSignal.portfolioEcosystem = ecosystem;
        matchingSignal.portfolioEcosystemMultiplier =
          ecosystem.ecosystemMultiplier;
        matchingSignal.portfolioPressureScore =
          ecosystem.portfolioPressureScore;
        matchingSignal.portfolioEcosystemMode =
          ecosystem.ecosystemMode;
        matchingSignal.allocationMultiplier = Number(
          (
            Number(matchingSignal.allocationMultiplier || 1) *
            Number(ecosystem.ecosystemMultiplier || 1)
          ).toFixed(2)
        );
        if (ecosystem.blockNewTrade) {
          matchingSignal.autoTradeApproved = false;
          matchingSignal.approved = false;
          matchingSignal.decisionLevel =
            "Blocked By Portfolio Ecosystem Intelligence";
        }
        if (ecosystem.reduceSize && !ecosystem.blockNewTrade) {
          matchingSignal.decisionLevel =
            "Reduced By Portfolio Ecosystem Intelligence";
        }
      }
      recordOrder("PHASE_71_PORTFOLIO_ECOSYSTEM_UPDATED", "MARKET", {
        reviewedSignals: portfolioEcosystem.state.reviewedSignals,
        ecosystemMode: portfolioEcosystem.state.ecosystemMode,
        portfolioPressureScore:
          portfolioEcosystem.state.portfolioPressureScore,
        dominantArchetype:
          portfolioEcosystem.state.dominantArchetype,
        dominantSector:
          portfolioEcosystem.state.dominantSector,
      });
      const liveMomentumMutation =
        calculateLiveMomentumMutation(signals);
      engineState.liveMomentumMutationState =
        liveMomentumMutation.state;
      engineState.liveMomentumMutationHistory.unshift(
        liveMomentumMutation.state
      );
      engineState.liveMomentumMutationHistory =
        engineState.liveMomentumMutationHistory.slice(0, 300);
      for (const mutation of liveMomentumMutation.mutatedSignals) {
        const matchingSignal = signals.find(
          (signal) =>
            normalizeSymbol(signal.symbol) === normalizeSymbol(mutation.symbol)
        );
        if (!matchingSignal) continue;
        matchingSignal.liveMomentumMutation = mutation;
        matchingSignal.liveMutatedScore = mutation.liveMutatedScore;
        matchingSignal.liveMutationMode = mutation.mutationMode;
        matchingSignal.liveMovePercent = mutation.liveMovePercent;
        matchingSignal.livePrice = Number(
          mutation.livePrice ||
          mutation.price ||
          matchingSignal.livePrice ||
          matchingSignal.price ||
          0
        );
        matchingSignal.displayPrice =
          matchingSignal.livePrice || matchingSignal.price;
        if (mutation.liveQuoteUpdatedAt) {
          matchingSignal.liveQuoteUpdatedAt = mutation.liveQuoteUpdatedAt;
        }
        if (mutation.liveQuoteSource) {
          matchingSignal.liveQuoteSource = mutation.liveQuoteSource;
        }
        matchingSignal.priceIsLive = mutation.priceIsLive === true;
        matchingSignal.displayPrice = matchingSignal.livePrice || matchingSignal.price;
        matchingSignal.score = clampScore(
          Number(matchingSignal.score || 0) * 0.82 +
          Number(mutation.liveMutatedScore || 0) * 0.18
        );
        if (mutation.liveFade) {
          matchingSignal.autoTradeApproved = false;
          matchingSignal.decisionLevel = "Live Momentum Fade Warning";
        }
        if (mutation.liveIgnition) {
          matchingSignal.decisionLevel = "Live Runner Ignition Detected";
          matchingSignal.allocationMultiplier = Number(
            (
              Number(matchingSignal.allocationMultiplier || 1) * 1.08
            ).toFixed(2)
          );
        }
      }
      recordOrder("PHASE_73_LIVE_MOMENTUM_MUTATION_UPDATED", "MARKET", {
        reviewedCount: liveMomentumMutation.state.reviewedCount,
        ignitionCount: liveMomentumMutation.state.ignitionCount,
        fadeCount: liveMomentumMutation.state.fadeCount,
        staleCount: liveMomentumMutation.state.staleCount,
      });
      const dynamicCapitalParliament =
        calculateDynamicCapitalParliament(
          signals,
          engineState.portfolioEcosystemState
        );
      engineState.dynamicCapitalParliamentState =
        dynamicCapitalParliament.state;
      engineState.dynamicCapitalParliamentHistory.unshift(
        dynamicCapitalParliament.state
      );
      engineState.dynamicCapitalParliamentHistory =
        engineState.dynamicCapitalParliamentHistory.slice(0, 300);
      for (const capitalVote of dynamicCapitalParliament.adjustedSignals) {
        const matchingSignal = signals.find(
          (signal) =>
            normalizeSymbol(signal.symbol) === normalizeSymbol(capitalVote.symbol)
        );
        if (!matchingSignal) continue;
        matchingSignal.dynamicCapitalParliament = capitalVote;
        matchingSignal.capitalVoteScore = capitalVote.capitalVoteScore;
        matchingSignal.capitalPriority = capitalVote.capitalPriority;
        matchingSignal.capitalParliamentAction =
          capitalVote.capitalParliamentAction;
        matchingSignal.capitalParliamentMultiplier =
          capitalVote.capitalParliamentMultiplier;
        matchingSignal.capitalMode = capitalVote.capitalMode;
        matchingSignal.allocationMultiplier = Number(
          (
            Number(matchingSignal.allocationMultiplier || 1) *
            Number(capitalVote.capitalParliamentMultiplier || 1)
          ).toFixed(2)
        );
        if (capitalVote.capitalParliamentAction === "NO_CAPITAL") {
          matchingSignal.autoTradeApproved = false;
          matchingSignal.approved = false;
          matchingSignal.decisionLevel =
            "No Capital From Dynamic Capital Parliament";
        }
        if (
          capitalVote.capitalParliamentAction === "ROUTE_ELITE_CAPITAL" ||
          capitalVote.capitalParliamentAction === "ROUTE_PRIORITY_CAPITAL"
        ) {
          matchingSignal.decisionLevel =
            capitalVote.capitalParliamentAction;
        }
      }
      recordOrder("PHASE_72_DYNAMIC_CAPITAL_PARLIAMENT_UPDATED", "MARKET", {
        reviewedCount: dynamicCapitalParliament.state.reviewedCount,
        approvedVoteCount:
          dynamicCapitalParliament.state.approvedVoteCount,
        capitalMode:
          dynamicCapitalParliament.state.capitalMode,
        dominantCapitalArchetype:
          dynamicCapitalParliament.state.dominantCapitalArchetype,
      });
      const liquiditySweepTrap =
        calculateLiquiditySweepTrapIntelligence(signals);
      engineState.liquiditySweepTrapState =
        liquiditySweepTrap.state;
      engineState.liquiditySweepTrapHistory.unshift(
        liquiditySweepTrap.state
      );
      engineState.liquiditySweepTrapHistory =
        engineState.liquiditySweepTrapHistory.slice(0, 300);
      for (const trap of liquiditySweepTrap.reviewedSignals) {
        const matchingSignal = signals.find(
          (signal) =>
            normalizeSymbol(signal.symbol) === normalizeSymbol(trap.symbol)
        );
        if (!matchingSignal) continue;
        matchingSignal.liquiditySweepTrap = trap;
        matchingSignal.liquiditySweepMode =
          trap.liquiditySweepMode;
        matchingSignal.trapRiskScore =
          trap.trapRiskScore;
        matchingSignal.squeezeIgnition =
          trap.squeezeIgnition;
        matchingSignal.allocationMultiplier = Number(
          (
            Number(matchingSignal.allocationMultiplier || 1) *
            Number(trap.liquidityTrapMultiplier || 1)
          ).toFixed(2)
        );
        if (trap.shouldBlockForTrap) {
          matchingSignal.autoTradeApproved = false;
          matchingSignal.approved = false;
          matchingSignal.decisionLevel =
            "Blocked By Liquidity Sweep Trap Intelligence";
        }
        if (trap.shouldReduceForTrap && !trap.shouldBlockForTrap) {
          matchingSignal.decisionLevel =
            "Reduced By Liquidity Sweep Trap Intelligence";
        }
        if (trap.squeezeIgnition) {
          matchingSignal.decisionLevel =
            "Squeeze Ignition Confirmed";
        }
      }
      recordOrder("PHASE_77_LIQUIDITY_SWEEP_TRAP_UPDATED", "MARKET", {
        reviewedCount: liquiditySweepTrap.state.reviewedCount,
        trapCount: liquiditySweepTrap.state.trapCount,
        squeezeIgnitionCount:
          liquiditySweepTrap.state.squeezeIgnitionCount,
      });
      const autonomousHedgeFundLayer =
        calculateAutonomousHedgeFundLayer(signals);
      engineState.autonomousHedgeFundLayerState =
        autonomousHedgeFundLayer.state;
      engineState.autonomousHedgeFundLayerHistory.unshift(
        autonomousHedgeFundLayer.state
      );
      engineState.autonomousHedgeFundLayerHistory =
        engineState.autonomousHedgeFundLayerHistory.slice(0, 300);
      for (const hedge of autonomousHedgeFundLayer.adjustedSignals) {
        const matchingSignal = signals.find(
          (signal) =>
            normalizeSymbol(signal.symbol) === normalizeSymbol(hedge.symbol)
        );
        if (!matchingSignal) continue;
        matchingSignal.autonomousHedgeFundLayer = hedge;
        matchingSignal.hedgeFundMode = hedge.hedgeFundMode;
        matchingSignal.hedgeFundAction = hedge.hedgeFundAction;
        matchingSignal.hedgeFundSignalMultiplier =
          hedge.hedgeFundSignalMultiplier;
        matchingSignal.allocationMultiplier = Number(
          (
            Number(matchingSignal.allocationMultiplier || 1) *
            Number(hedge.hedgeFundSignalMultiplier || 1)
          ).toFixed(2)
        );
        if (
          hedge.hedgeFundAction === "DEFEND_CAPITAL_REDUCE" ||
          hedge.hedgeFundAction === "DECONCENTRATE_REDUCE"
        ) {
          matchingSignal.decisionLevel = hedge.hedgeFundAction;
        }
        if (hedge.hedgeFundAction === "EXPAND_RUNNER_CAPITAL") {
          matchingSignal.decisionLevel =
            "Autonomous Hedge Fund Expanding Runner Capital";
        }
      }
      recordOrder("PHASE_78_AUTONOMOUS_HEDGE_FUND_LAYER_UPDATED", "MARKET", {
        reviewedCount: autonomousHedgeFundLayer.state.reviewedCount,
        hedgeFundMode: autonomousHedgeFundLayer.state.hedgeFundMode,
        globalCapitalMultiplier:
          autonomousHedgeFundLayer.state.globalCapitalMultiplier,
        eliteCandidateCount:
          autonomousHedgeFundLayer.state.eliteCandidateCount,
      });
      const autonomousMetaReinforcement =
        calculateAutonomousMetaReinforcement(signals);
      engineState.autonomousMetaReinforcementState =
        autonomousMetaReinforcement.state;
      engineState.autonomousMetaReinforcementHistory.unshift(
        autonomousMetaReinforcement.state
      );
      engineState.autonomousMetaReinforcementHistory =
        engineState.autonomousMetaReinforcementHistory.slice(0, 300);
      for (const meta of autonomousMetaReinforcement.adjustedSignals) {
        const matchingSignal = signals.find(
          (signal) =>
            normalizeSymbol(signal.symbol) === normalizeSymbol(meta.symbol)
        );
        if (!matchingSignal) continue;
        matchingSignal.autonomousMetaReinforcement = meta;
        matchingSignal.metaAggressionMultiplier =
          meta.metaAggressionMultiplier;
        matchingSignal.metaThresholdAdjustment =
          meta.metaThresholdAdjustment;
        matchingSignal.metaScoreAdjustment =
          meta.metaScoreAdjustment;
        matchingSignal.metaAggressionMode =
          meta.aggressionMode;
        matchingSignal.score = clampScore(
          Number(matchingSignal.score || 0) +
          Number(meta.metaScoreAdjustment || 0)
        );
        matchingSignal.allocationMultiplier = Number(
          (
            Number(matchingSignal.allocationMultiplier || 1) *
            Number(meta.metaAggressionMultiplier || 1)
          ).toFixed(2)
        );
        if (meta.blockedButStrong) {
          matchingSignal.decisionLevel =
            "Meta Reinforcement Suppression Relief Candidate";
        }
      }
      recordOrder("PHASE_76_AUTONOMOUS_META_REINFORCEMENT_UPDATED", "MARKET", {
        reviewedCount:
          autonomousMetaReinforcement.state.reviewedCount,
        aggressionMode:
          autonomousMetaReinforcement.state.aggressionMode,
        approvalRate:
          autonomousMetaReinforcement.state.approvalRate,
        blockRate:
          autonomousMetaReinforcement.state.blockRate,
      });
      const centralAutonomousDecisionCore =
        calculateCentralAutonomousDecisionCore(stockSignals, cryptoSignals);
      engineState.aiParliamentVotingState = {
        updatedAt: new Date().toISOString(),
        phase: "75_AI_PARLIAMENT_VOTING_SYSTEM",
        reviewedCount:
          centralAutonomousDecisionCore.rankedDecisions?.length || 0,
        topVotes:
          (centralAutonomousDecisionCore.rankedDecisions || [])
            .map((decision) => ({
              symbol: decision.symbol,
              tradeArchetype: decision.tradeArchetype,
              parliamentDecision: decision.parliamentDecision,
              parliamentConfidence: decision.parliamentConfidence,
              action: decision.action,
            }))
            .slice(0, 15),
      };
      engineState.aiParliamentVotingHistory.unshift(
        engineState.aiParliamentVotingState
      );
      engineState.aiParliamentVotingHistory =
        engineState.aiParliamentVotingHistory.slice(0, 300);
      engineState.centralAutonomousDecisionCoreState =
        centralAutonomousDecisionCore.state;
      engineState.centralAutonomousDecisionCoreHistory.unshift(
        centralAutonomousDecisionCore.state
      );
      engineState.centralAutonomousDecisionCoreHistory =
        engineState.centralAutonomousDecisionCoreHistory.slice(0, 200);
      recordOrder("CENTRAL_AUTONOMOUS_DECISION_CORE_UPDATED", "MARKET", {
        reviewedCount: centralAutonomousDecisionCore.state.reviewedCount,
        approvedCount: centralAutonomousDecisionCore.state.approvedCount,
        blockedCount: centralAutonomousDecisionCore.state.blockedCount,
        masterCapitalMultiplier:
          centralAutonomousDecisionCore.state.masterCapitalMultiplier,
      });
      broadcastTapeEvent(
        "TOP_AI_BRAIN_UPDATE",
        {
          topBrains: buildTopAiBrains(),
        }
      );
      for (const decision of centralAutonomousDecisionCore.rankedDecisions) {
        const matchingSignal = signals.find(
          (signal) =>
            normalizeSymbol(signal.symbol) === normalizeSymbol(decision.symbol)
        );
        if (!matchingSignal) continue;
        matchingSignal.centralAutonomousDecisionCore = decision;
        matchingSignal.tradeArchetype = decision.tradeArchetype;
        matchingSignal.dynamicEngineWeights = decision.dynamicEngineWeights;
        matchingSignal.archetypeAdjustedScore = decision.archetypeAdjustedScore;
        matchingSignal.aiParliamentVote = decision.aiParliamentVote;
        matchingSignal.parliamentDecision = decision.parliamentDecision;
        matchingSignal.parliamentConfidence = decision.parliamentConfidence;
        matchingSignal.contradictionState = decision.contradictionState;
        matchingSignal.eliteOverride = decision.eliteOverride;
        matchingSignal.centralCoreExecution = decision.centralCoreExecution;
        matchingSignal.executionStyle = decision.executionStyle;
        matchingSignal.executionSizeMultiplier =
          decision.executionSizeMultiplier;
        matchingSignal.shouldWaitForPullback =
          decision.shouldWaitForPullback;
        matchingSignal.centralCoreHardBlock = decision.hardBlock;
        matchingSignal.centralCoreSoftBlock = decision.softBlock;
        matchingSignal.finalAutonomousDecisionScore =
          decision.finalDecisionScore;
        if (cryptoSignals.includes(matchingSignal)) {
          matchingSignal.cryptoDecisionScore = decision.finalDecisionScore;
        }
        matchingSignal.centralAutonomousAction = decision.action;
        const finalMasterDecisionProfile =
          calculateFinalMasterDecisionProfile(matchingSignal);
        matchingSignal.finalMasterDecisionProfile =
          finalMasterDecisionProfile;
        matchingSignal.masterFinalScore =
          finalMasterDecisionProfile.finalScore;
        matchingSignal.masterFinalSizingMultiplier =
          finalMasterDecisionProfile.finalSizingMultiplier;
        matchingSignal.masterExecutionDecision =
          finalMasterDecisionProfile.executionDecision;
        matchingSignal.finalExitProfile =
          finalMasterDecisionProfile.finalExitProfile;
        matchingSignal.score =
          finalMasterDecisionProfile.finalScore;
        matchingSignal.allocationMultiplier = Number(
          (
            Number(matchingSignal.allocationMultiplier || 1) *
            Number(finalMasterDecisionProfile.finalSizingMultiplier || 0)
          ).toFixed(2)
        );
        if (
          finalMasterDecisionProfile.suppressEntry &&
          decision.action !== "ALLOW_REDUCED_SIZE"
        ) {
          matchingSignal.autoTradeApproved = false;
          matchingSignal.approved = false;
          matchingSignal.decisionLevel =
            finalMasterDecisionProfile.waitForPullback
              ? "Final Master Decision Waiting For Pullback"
              : "Blocked By Final Master Decision Profile";
        }
        if (decision.shouldBlock && decision.action !== "ALLOW_REDUCED_SIZE") {
          matchingSignal.autoTradeApproved = false;
          matchingSignal.approved = false;
          matchingSignal.decisionLevel =
            "Blocked By Central Autonomous Decision Core";
        }
        if (decision.action === "WAIT_FOR_PULLBACK") {
          matchingSignal.autoTradeApproved = false;
          matchingSignal.approved = true;
          matchingSignal.decisionLevel =
            "Central Core Waiting For Micro Pullback";
          matchingSignal.pullbackWatch = true;
        }
        if (decision.action === "ALLOW_REDUCED_SIZE") {
          matchingSignal.autoTradeApproved = true;
          matchingSignal.approved = true;
          matchingSignal.decisionLevel =
            "Elite Override: Reduced Size Approval";
          matchingSignal.allocationMultiplier = Number(
            (
              Number(matchingSignal.allocationMultiplier || 1) * 0.5
            ).toFixed(2)
          );
        }
        if (decision.shouldAccelerate) {
          matchingSignal.decisionLevel =
            "Central Core Accelerated Capital";
          matchingSignal.allocationMultiplier = Number(
            (
              Number(matchingSignal.allocationMultiplier || 1) *
              Number(decision.masterCapitalMultiplier || 1)
            ).toFixed(2)
          );
        }
      }
      const penaltyCompression =
        calculatePenaltyCompressionAndEliteOverride(signals);
      engineState.penaltyCompressionState = penaltyCompression;
      engineState.penaltyCompressionHistory.unshift(penaltyCompression);
      engineState.penaltyCompressionHistory =
        engineState.penaltyCompressionHistory.slice(0, 200);
      for (const compressed of penaltyCompression.compressedSignals) {
        const matchingSignal = signals.find(
          (signal) =>
            normalizeSymbol(signal.symbol) === normalizeSymbol(compressed.symbol)
        );
        if (!matchingSignal) continue;
        matchingSignal.penaltyCompression = compressed;
        matchingSignal.penaltyCompressedMultiplier =
          compressed.compressedMultiplier;
        matchingSignal.rawStackedMultiplier =
          compressed.rawStackedMultiplier;
        matchingSignal.eliteOverride =
          compressed.eliteOverride;
        matchingSignal.penaltyCompressionActive =
          compressed.activePenaltyCount >= 2;
        if (compressed.shouldRestoreApproval) {
          matchingSignal.autoTradeApproved = true;
          matchingSignal.approved = true;
          matchingSignal.decisionLevel =
            compressed.correctedDecisionLevel;
          matchingSignal.allocationMultiplier =
            compressed.compressedMultiplier;
          matchingSignal.portfolioAction = "ELITE_OVERRIDE_DEPLOY";
          matchingSignal.aiPortfolioAction = "ELITE_OVERRIDE_DEPLOY";
        } else {
          matchingSignal.decisionLevel =
            compressed.correctedDecisionLevel;
          matchingSignal.allocationMultiplier =
            Math.max(
              Number(matchingSignal.allocationMultiplier || 0.25),
              compressed.compressedMultiplier
            );
        }
      }
      const ENGINE_HISTORY_KEYS = [
        "marketRegimeHistory",
        "marketCycleIntelligenceHistory",
        "institutionalDashboardSnapshots",
        "signalHistory",
        "aiDecisionHistory",
        "sectorRotationHistory",
        "sectorDominationHistory",
        "capitalRedistributionHistory",
        "institutionalRebalanceHistory",
        "capitalCompoundingHistory",
        "multiTimeframeHistory",
        "marketCrashProtectionHistory",
        "technicalIntelligenceHistory",
        "institutionalOrchestratorHistory",
        "dcfValuationHistory",
        "competitiveAdvantageHistory",
        "earningsIntelligenceHistory",
        "portfolioOptimizationHistory",
        "dividendCompoundingHistory",
        "macroRiskHistory",
        "liquidityIntelligenceHistory",
        "correlationIntelligenceHistory",
        "portfolioGovernorHistory",
        "selfOptimizationHistory",
        "reinforcementWeightHistory",
        "executionIntelligenceHistory",
        "autonomousTradingSystemHistory",
        "phase20AutonomousOrchestrationHistory",
        "crossEngineMemoryHistory",
        "adaptiveExecutionTimingHistory",
        "phase21AutonomousBrainHistory",
        "liveAiPerformanceHistory",
        "signalQualityHistory",
        "marketBreadthHistory",
        "marketMomentumHistory",
        "marketVolatilityHistory",
        "institutionalExposureHistory",
        "analyticsSnapshots",
        "selfHealingScanHistory",
        "finalDashboardSignalSyncHistory",
      ];
      for (const historyKey of ENGINE_HISTORY_KEYS) {
        if (!Array.isArray(engineState[historyKey])) {
          engineState[historyKey] = [];
        }
      }
      const previousMarketRegimeState =
        engineState.marketRegime?.state || null;
      engineState.marketRegime = detectMarketRegime(stockSignals);
      const marketRegimeDominance =
        calculateRegimeDominance(
          engineState.marketRegime,
          stockSignals
        );
      if (
        previousMarketRegimeState &&
        previousMarketRegimeState !== engineState.marketRegime?.state
      ) {
        broadcastTapeEvent("MARKET_REGIME_CHANGED", {
          previousRegime: previousMarketRegimeState,
          currentRegime: engineState.marketRegime?.state,
          exposureMultiplier: engineState.marketRegime?.exposureMultiplier,
        });
      }
      engineState.marketRegimeHistory.unshift({
        timestamp: new Date().toISOString(),
        regime: engineState.marketRegime,
      });
      engineState.marketRegimeHistory =
        engineState.marketRegimeHistory.slice(0, 200);
      engineState.marketCycleIntelligenceState =
        calculateMarketPhase(stockSignals, cryptoSignals);
      engineState.marketCycleIntelligenceHistory.unshift(
        engineState.marketCycleIntelligenceState
      );
      engineState.marketCycleIntelligenceHistory =
        engineState.marketCycleIntelligenceHistory.slice(0, 200);
      signals.sort(
        (a, b) => Number(b.score || 0) - Number(a.score || 0)
      );
      if (
        !Array.isArray(
          engineState.institutionalDashboardSnapshots
        )
      ) {
        engineState.institutionalDashboardSnapshots = [];
      }
      engineState.lastSignals = signals;
      refreshFinnhubLiveSubscriptions();
      engineState.institutionalDashboardSnapshots.unshift({
        createdAt: new Date().toISOString(),
        dashboard:
          buildInstitutionalDashboardPayload(),
      });
      engineState.institutionalDashboardSnapshots =
        engineState.institutionalDashboardSnapshots.slice(
          0,
          200
        );
      engineState.lastSuccessfulCycleAt =
        new Date().toISOString();
      engineState.marketMomentumScore =
        stockSignals.reduce(
          (sum, s) =>
            sum + Number(s.percentChange || 0),
          0
        ) / Math.max(1, stockSignals.length);
      engineState.averageSignalScore =
        signals.reduce(
          (sum, s) => sum + Number(s.score || 0),
          0
        ) / Math.max(1, signals.length);
      engineState.lastStockSignals = stockSignals;
      engineState.lastCryptoSignals = cryptoSignals;
      emitSignalTapeTransitions(signals);
      emitSystemRiskTapeState({
        reason: "Final scan reconciliation completed.",
      });
      engineState.lastScanAt = new Date().toISOString();
      engineState.signalHistory.unshift({
        timestamp: new Date().toISOString(),
        signalCount: signals.length,
        topSignals: signals.slice(0, 10),
        averageTopScore:
          signals.slice(0, 10).reduce(
            (sum, s) => sum + Number(s.score || 0),
            0
          ) / Math.max(1, signals.slice(0, 10).length),
      });
      engineState.signalHistory =
        engineState.signalHistory.slice(0, 200);
      engineState.aiDecisionHistory.unshift({
        timestamp: new Date().toISOString(),
        marketRegime: engineState.marketRegime,
        marketStressLevel:
          engineState.marketStressLevel,
        totalSignals: signals.length,
        stockSignals: stockSignals.length,
        cryptoSignals: cryptoSignals.length,
      });
      engineState.aiDecisionHistory =
        engineState.aiDecisionHistory.slice(0, 500);
      const sectorRotation = calculateAiSectorRotationEngine(stockSignals);
      engineState.sectorRotationState = sectorRotation;
      engineState.sectorRotationHistory.unshift(sectorRotation);
      engineState.sectorRotationHistory =
        engineState.sectorRotationHistory.slice(0, 200);
      const sectorDominance =
        calculateInstitutionalSectorDominanceEngine(stockSignals);
      engineState.sectorDominanceState = sectorDominance;
      engineState.sectorDominationState = sectorDominance;
      if (!Array.isArray(engineState.sectorDominanceHistory)) {
        engineState.sectorDominanceHistory = [];
      }
      engineState.sectorDominanceHistory.unshift(sectorDominance);
      engineState.sectorDominanceHistory =
        engineState.sectorDominanceHistory.slice(0, 200);
      engineState.sectorDominationHistory =
        engineState.sectorDominanceHistory;
      stockSignals = stockSignals.map((signal) =>
        applyInstitutionalSectorDominance(signal)
      );
      const analyticsPositions = Array.isArray(engineState.cachedPositions)
        ? engineState.cachedPositions
        : [];
      const analyticsAiPositions = analyticsPositions.filter((position) => {
        const symbol = normalizeSymbol(position.symbol);
        if (!symbol) return false;
        if (
          Array.isArray(engineState.aiManagedSymbols) &&
          engineState.aiManagedSymbols.includes(symbol)
        ) {
          return true;
        }
        return String(position.asset_class || "").toLowerCase() === "us_equity";
      });
      // Always finalize crypto evidence, including SMART mode cycles that also
      // contain stocks. Keep scanner, entry-realism, and master scores separate.
      for (const signal of cryptoSignals) {
        const cryptoRealism = calculateCryptoSignalRealismEngine(signal);
        signal.cryptoRealism = cryptoRealism;
        signal.realismAdjustedScore = cryptoRealism.realismScore;
        signal.cryptoEntryScore = cryptoRealism.entryQualityScore;
        signal.cryptoRiskPenalty = cryptoRealism.cryptoRiskPenalty;
        signal.cryptoRealismReason = cryptoRealism.cryptoRealismReason;
        signal.cryptoScoreTelemetry = {
          ...(signal.cryptoScoreTelemetry || {}),
          entry: {
            score: cryptoRealism.entryQualityScore,
            coverage: cryptoRealism.coverage,
            penalties: cryptoRealism.penaltyComponents,
            missingComponents: cryptoRealism.missingComponents,
            gates: cryptoRealism.entryBlockReasons,
          },
          decision: {
            score: Number(
              signal.masterFinalScore ??
              signal.finalAutonomousDecisionScore ??
              signal.score ??
              cryptoRealism.realismScore
            ),
            source: signal.masterFinalScore !== undefined
              ? "master_final_score"
              : "central_autonomous_decision",
            coverage: Number(
              signal.centralAutonomousDecisionCore?.scoreCoverage || 0
            ),
            components:
              signal.centralAutonomousDecisionCore?.scoreComponents || [],
            missingComponents:
              signal.centralAutonomousDecisionCore?.missingScoreComponents || [],
          },
        };
        const cryptoLiquidityPass = cryptoRealism.liquidityPass === true;
        const decisionScore = Number(
          signal.masterFinalScore ??
          signal.finalAutonomousDecisionScore ??
          cryptoRealism.realismScore
        );
        signal.qualifiedToBuy =
          signal.qualifiedToBuy === true &&
          cryptoLiquidityPass &&
          cryptoRealism.spreadAvailable === true &&
          Number(cryptoRealism.barsFound || 0) >= 10 &&
          decisionScore >=
          Number(
            engineState.selfOptimizationState?.adaptiveMinScoreToBuy ||
            CONFIG.minScoreToBuy ||
            70
          );
        if (!cryptoLiquidityPass || cryptoRealism.spreadAvailable !== true) {
          signal.autoTradeApproved = false;
          signal.approved = false;
          signal.decisionLevel = "Blocked By Crypto Entry Data Quality";
        }
      }
      const allSignalsForAnalytics =
        Array.isArray(stockSignals) && stockSignals.length > 0
          ? stockSignals
          : Array.isArray(cryptoSignals) && cryptoSignals.length > 0
            ? cryptoSignals
            : Array.isArray(engineState.lastSignals)
              ? engineState.lastSignals
              : [];
      const updatedInstitutionalWatchlist =
        updateInstitutionalWatchlist(allSignalsForAnalytics);
      engineState.institutionalWatchlist = updatedInstitutionalWatchlist;
      const capitalRedistribution = calculateSmartCapitalRedistributionEngine(
        account,
        analyticsAiPositions,
        allSignalsForAnalytics,
        engineState.sectorRotationState
      );
      engineState.capitalRedistributionState = capitalRedistribution;
      engineState.capitalRedistributionHistory.unshift(capitalRedistribution);
      engineState.capitalRedistributionHistory =
        engineState.capitalRedistributionHistory.slice(0, 200);
      const institutionalRebalance =
        calculateInstitutionalRebalanceIntelligence(
          account,
          analyticsAiPositions,
          allSignalsForAnalytics
        );
      engineState.institutionalRebalanceState =
        institutionalRebalance;
      if (!Array.isArray(engineState.institutionalRebalanceHistory)) {
        engineState.institutionalRebalanceHistory = [];
      }
      engineState.institutionalRebalanceHistory.unshift(
        institutionalRebalance
      );
      engineState.institutionalRebalanceHistory =
        engineState.institutionalRebalanceHistory.slice(0, 200);
      const capitalCompounding =
        calculateSmartCapitalCompoundingEngine(
          account,
          analyticsAiPositions
        );
      engineState.capitalCompoundingState =
        capitalCompounding;
      engineState.capitalCompoundingHistory.unshift(
        capitalCompounding
      );
      engineState.capitalCompoundingHistory =
        engineState.capitalCompoundingHistory.slice(0, 200);
      const multiTimeframeAnalysis =
        calculateMultiTimeframeConfirmationEngine(allSignalsForAnalytics);
      engineState.multiTimeframeState = multiTimeframeAnalysis;
      engineState.multiTimeframeHistory.unshift(multiTimeframeAnalysis);
      engineState.multiTimeframeHistory =
        engineState.multiTimeframeHistory.slice(0, 200);
      const marketCrashProtection =
        calculateAiMarketCrashProtectionEngine(
          allSignalsForAnalytics,
          engineState.marketRegime,
          account
        );
      engineState.marketCrashProtectionState =
        marketCrashProtection;
      engineState.marketCrashProtectionHistory.unshift(
        marketCrashProtection
      );
      engineState.marketCrashProtectionHistory =
        engineState.marketCrashProtectionHistory.slice(0, 200);
      const getUnifiedTechnicalScore = (signal = {}) => {
        const directScore = Number(
          signal.technicalIntelligence?.institutionalEntryScore ||
          signal.technicalScore ||
          0
        );
        if (directScore > 0) {
          return clampScore(directScore);
        }
        return clampScore(
          Number(signal.score || 0) * 0.85 +
          (Number(signal.barsFound || 0) >= 30
            ? 15
            : Number(signal.barsFound || 0) >= 20
              ? 10
              : Number(signal.barsFound || 0) >= 10
                ? 5
                : 0) +
          (signal.qualifiedToBuy !== false ? 5 : -20)
        );
      };
      const getUnifiedExhaustionRisk = (signal = {}) => {
        const directRisk = Number(
          signal.technicalIntelligence?.exhaustionRiskScore ||
          signal.exhaustionRiskScore ||
          0
        );
        if (directRisk > 0) {
          return clampScore(directRisk);
        }
        return clampScore(
          35 -
          (Number(signal.score || 0) >= 80 ? 10 : 0) +
          (signal.qualifiedToBuy === false ? 20 : 0)
        );
      };
      const technicalSignals =
        allSignalsForAnalytics.filter(
          (signal) => getUnifiedTechnicalScore(signal) >= 65
        );
      const averageTechnicalScore =
        allSignalsForAnalytics.length > 0
          ? allSignalsForAnalytics.reduce(
            (sum, signal) => sum + getUnifiedTechnicalScore(signal),
            0
          ) / allSignalsForAnalytics.length
          : 0;
      const averageExhaustionRisk =
        allSignalsForAnalytics.length > 0
          ? allSignalsForAnalytics.reduce(
            (sum, signal) => sum + getUnifiedExhaustionRisk(signal),
            0
          ) / allSignalsForAnalytics.length
          : 0;
      engineState.technicalIntelligenceState = {
        updatedAt: new Date().toISOString(),
        qualifyingTechnicalSignals: technicalSignals.length,
        averageTechnicalScore: Number(averageTechnicalScore.toFixed(2)),
        averageExhaustionRisk: Number(averageExhaustionRisk.toFixed(2)),
        strongestTechnicalSetups:
          technicalSignals
            .slice(0, 5)
            .map((signal) => ({
              symbol: signal.symbol,
              score: signal.score,
              technicalScore: getUnifiedTechnicalScore(signal),
              exhaustionRisk: getUnifiedExhaustionRisk(signal),
            })),
      };
      engineState.technicalIntelligenceHistory.unshift(
        engineState.technicalIntelligenceState
      );
      engineState.technicalIntelligenceHistory =
        engineState.technicalIntelligenceHistory.slice(0, 200);
      const orchestratedSignals =
        allSignalsForAnalytics.map((signal) => ({
          ...signal,
          institutionalOrchestrator:
            calculateInstitutionalAiPortfolioOrchestrator(signal),
        }));
      for (const signal of orchestratedSignals) {
        const realismScore = Number(
          signal.realismAdjustedScore ||
          signal.cryptoRealism?.realismScore ||
          signal.score ||
          0
        );
        const spreadPercent = Number(
          signal.cryptoRealism?.spreadPercent || 0
        );
        const statisticalScore =
          Number(signal.statisticalScore || 0) +
          Number(signal.statisticalEdgeScore || 0) +
          Number(signal.statisticalEdge?.statisticalEdgeScore || 0);
        const timeframeDecision =
          signal.timeframeDecision || "WEAK_CONFIRMATION";
        const finalInstitutionalDecisionScore =
          Number(
            signal.institutionalOrchestrator
              ?.finalInstitutionalDecisionScore || 0
          );
        signal.qualifiedToBuy =
          realismScore >= CONFIG.minScoreToBuy &&
          finalInstitutionalDecisionScore >= 65 &&
          spreadPercent <= 0.65 &&
          timeframeDecision !== "TIMEFRAME_CONFLICT" &&
          (
            statisticalScore > 0 ||
            realismScore >= 85
          );
      }
      const deployableOrchestratedSignals =
        orchestratedSignals.filter((signal) => {
          const finalScore = Number(
            signal.institutionalOrchestrator?.finalInstitutionalDecisionScore || 0
          );
          const action =
            signal.institutionalOrchestrator?.orchestratorAction || "BLOCK_TRADE";
          const timeframeDecision =
            signal.timeframeDecision ||
            engineState.multiTimeframeState?.topAlignedSignals?.find(
              (item) => normalizeSymbol(item.symbol) === normalizeSymbol(signal.symbol)
            )?.timeframeDecision ||
            "WEAK_CONFIRMATION";
          return (
            finalScore >= 70 &&
            action !== "BLOCK_TRADE" &&
            timeframeDecision !== "TIMEFRAME_CONFLICT"
          );
        });
      const averageOrchestratorScore =
        orchestratedSignals.length > 0
          ? orchestratedSignals.reduce(
            (sum, signal) =>
              sum +
              Number(
                signal.institutionalOrchestrator
                  ?.finalInstitutionalDecisionScore || 0
              ),
            0
          ) / orchestratedSignals.length
          : 0;
      if (!engineState.statisticalMemoryState) {
        engineState.statisticalMemoryState = {
          updatedAt: new Date().toISOString(),
          setupHistory: [],
          setupPerformance: {},
          expectancyHistory: [],
          probabilityHistory: [],
        };
      }
      const reinforcedSignals =
        orchestratedSignals.filter(
          (signal) =>
            Number(
              signal.institutionalOrchestrator
                ?.probabilityReinforcement
                ?.reinforcedProbability || 0
            ) >= 70
        );
      const weakeningSignals =
        orchestratedSignals.filter(
          (signal) =>
            signal.institutionalOrchestrator
              ?.probabilityReinforcement
              ?.reinforcementMode === "WEAKENING"
        );
      const averageReinforcedProbability =
        orchestratedSignals.length > 0
          ? orchestratedSignals.reduce(
            (sum, signal) =>
              sum +
              Number(
                signal.institutionalOrchestrator
                  ?.probabilityReinforcement
                  ?.reinforcedProbability || 0
              ),
            0
          ) / orchestratedSignals.length
          : 0;
      engineState.institutionalOrchestratorState = {
        updatedAt: new Date().toISOString(),
        totalSignals: orchestratedSignals.length,
        deployableSignals: deployableOrchestratedSignals.length,
        averageOrchestratorScore:
          Number(averageOrchestratorScore.toFixed(2)),
        reinforcedSignals: reinforcedSignals.length,
        weakeningSignals: weakeningSignals.length,
        averageReinforcedProbability:
          Number(
            averageReinforcedProbability.toFixed(2)
          ),
        strongestOrchestratedSignals:
          deployableOrchestratedSignals
            .slice(0, 5)
            .map((signal) => ({
              symbol: signal.symbol,
              score: signal.score,
              finalInstitutionalDecisionScore:
                signal.institutionalOrchestrator
                  ?.finalInstitutionalDecisionScore,
              orchestratorAction:
                signal.institutionalOrchestrator
                  ?.orchestratorAction,
              orchestratorMultiplier:
                signal.institutionalOrchestrator
                  ?.orchestratorMultiplier,
            })),
      };
      engineState.institutionalOrchestratorHistory.unshift(
        engineState.institutionalOrchestratorState
      );
      engineState.institutionalOrchestratorHistory =
        engineState.institutionalOrchestratorHistory.slice(
          0,
          200
        );
      const dcfValuationSignals =
        allSignalsForAnalytics.filter(
          (signal) =>
            Number(signal.dcfValuationScore || 0) >= 65
        );
      const highValuationRiskSignals =
        allSignalsForAnalytics.filter(
          (signal) =>
            Number(signal.valuationRiskScore || 0) >= 75
        );
      const averageDcfValuationScore =
        allSignalsForAnalytics.length > 0
          ? allSignalsForAnalytics.reduce(
            (sum, signal) =>
              sum +
              Number(signal.dcfValuationScore || 0),
            0
          ) / allSignalsForAnalytics.length
          : 0;
      engineState.dcfValuationState = {
        updatedAt: new Date().toISOString(),
        qualifyingDcfSignals:
          dcfValuationSignals.length,
        highValuationRiskSignals:
          highValuationRiskSignals.length,
        averageDcfValuationScore:
          Number(
            averageDcfValuationScore.toFixed(2)
          ),
        strongestDcfSetups:
          dcfValuationSignals
            .slice(0, 5)
            .map((signal) => ({
              symbol: signal.symbol,
              score: signal.score,
              dcfValuationScore:
                signal.dcfValuationScore,
              valuationRiskScore:
                signal.valuationRiskScore,
              valuationLabel:
                signal.valuationLabel,
              qualityAdjustedMarginOfSafety:
                signal.qualityAdjustedMarginOfSafety,
            })),
      };
      engineState.dcfValuationHistory.unshift(
        engineState.dcfValuationState
      );
      engineState.dcfValuationHistory =
        engineState.dcfValuationHistory.slice(
          0,
          200
        );
      const competitiveAdvantageSignals =
        allSignalsForAnalytics.filter(
          (signal) =>
            Number(signal.competitiveAdvantageScore || signal.moatScore || 0) >= 65
        );
      const averageCompetitiveAdvantageScore =
        allSignalsForAnalytics.length > 0
          ? allSignalsForAnalytics.reduce(
            (sum, signal) =>
              sum +
              Number(
                signal.competitiveAdvantageScore ||
                signal.moatScore ||
                0
              ),
            0
          ) / allSignalsForAnalytics.length
          : 0;
      engineState.competitiveAdvantageState = {
        updatedAt: new Date().toISOString(),
        qualifyingMoatSignals: competitiveAdvantageSignals.length,
        averageCompetitiveAdvantageScore:
          Number(averageCompetitiveAdvantageScore.toFixed(2)),
        strongestMoatCandidates: competitiveAdvantageSignals
          .slice(0, 5)
          .map((signal) => ({
            symbol: signal.symbol,
            score: signal.score,
            moatScore: signal.moatScore,
            competitiveAdvantageScore:
              signal.competitiveAdvantageScore,
            moatLabel: signal.moatLabel,
            estimatedSector: signal.estimatedSector,
          })),
      };
      engineState.competitiveAdvantageHistory.unshift(
        engineState.competitiveAdvantageState
      );
      engineState.competitiveAdvantageHistory =
        engineState.competitiveAdvantageHistory.slice(0, 200);
      const earningsSignals =
        allSignalsForAnalytics.filter(
          (signal) => Number(signal.earningsScore || 0) >= 70
        );
      const highEarningsRiskSignals =
        allSignalsForAnalytics.filter(
          (signal) =>
            signal.earningsRiskMode === "HIGH_EARNINGS_RISK" ||
            Number(signal.earningsVolatilityRiskScore || 0) >= 75
        );
      const averageEarningsScore =
        allSignalsForAnalytics.length > 0
          ? allSignalsForAnalytics.reduce(
            (sum, signal) =>
              sum + Number(signal.earningsScore || 0),
            0
          ) / allSignalsForAnalytics.length
          : 0;
      const averageEarningsVolatilityRisk =
        allSignalsForAnalytics.length > 0
          ? allSignalsForAnalytics.reduce(
            (sum, signal) =>
              sum +
              Number(signal.earningsVolatilityRiskScore || 0),
            0
          ) / allSignalsForAnalytics.length
          : 0;
      engineState.earningsIntelligenceState = {
        updatedAt: new Date().toISOString(),
        qualifyingEarningsSignals: earningsSignals.length,
        highEarningsRiskSignals: highEarningsRiskSignals.length,
        averageEarningsScore:
          Number(averageEarningsScore.toFixed(2)),
        averageEarningsVolatilityRisk:
          Number(averageEarningsVolatilityRisk.toFixed(2)),
        strongestEarningsSetups: earningsSignals
          .slice(0, 5)
          .map((signal) => ({
            symbol: signal.symbol,
            score: signal.score,
            earningsScore: signal.earningsScore,
            earningsRiskMode: signal.earningsRiskMode,
            earningsAction: signal.earningsAction,
          })),
        riskiestEarningsSetups: highEarningsRiskSignals
          .slice(0, 5)
          .map((signal) => ({
            symbol: signal.symbol,
            score: signal.score,
            earningsScore: signal.earningsScore,
            earningsRiskMode: signal.earningsRiskMode,
            earningsVolatilityRiskScore:
              signal.earningsVolatilityRiskScore,
          })),
      };
      engineState.earningsIntelligenceHistory.unshift(
        engineState.earningsIntelligenceState
      );
      engineState.earningsIntelligenceHistory =
        engineState.earningsIntelligenceHistory.slice(0, 200);
      const portfolioOptimization =
        calculateBlackRockPortfolioOptimizer(
          account,
          analyticsAiPositions,
          allSignalsForAnalytics
        );
      engineState.portfolioOptimizationState =
        portfolioOptimization;
      engineState.portfolioOptimizationHistory.unshift(
        portfolioOptimization
      );
      engineState.portfolioOptimizationHistory =
        engineState.portfolioOptimizationHistory.slice(
          0,
          200
        );
      const dividendCompounders = allSignalsForAnalytics
        .map((signal) => ({
          symbol: signal.symbol,
          score: Number(signal.score || 0),
          harvardDividendScore: Number(
            signal.harvardDividendScore ||
            signal.harvardDividendCompounding
              ?.harvardDividendCompoundingScore ||
            0
          ),
          harvardDividendProfile:
            signal.harvardDividendProfile ||
            signal.harvardDividendCompounding
              ?.harvardDividendProfile ||
            "Unknown",
          dividendScore: Number(signal.dividendScore || 0),
          wealthProfile: signal.wealthProfile || "Unknown",
        }))
        .filter((item) => item.harvardDividendScore > 0)
        .sort(
          (a, b) =>
            Number(b.harvardDividendScore || 0) -
            Number(a.harvardDividendScore || 0)
        )
        .slice(0, 10);
      engineState.dividendCompoundingState = {
        updatedAt: new Date().toISOString(),
        phase: "15.7_HARVARD_DIVIDEND_COMPOUNDING_ENGINE",
        reviewedCount: allSignalsForAnalytics.length,
        topDividendCompounders: dividendCompounders,
        eliteCompounderCount: dividendCompounders.filter(
          (item) => item.harvardDividendScore >= 85
        ).length,
        reason:
          `Dividend engine reviewed ${allSignalsForAnalytics.length} signals ` +
          `and found ${dividendCompounders.length} dividend/compounder candidates.`,
      };
      if (!Array.isArray(engineState.dividendCompoundingHistory)) {
        engineState.dividendCompoundingHistory = [];
      }
      engineState.dividendCompoundingHistory.unshift(
        engineState.dividendCompoundingState
      );
      engineState.dividendCompoundingHistory =
        engineState.dividendCompoundingHistory.slice(0, 200);
      const macroRisk =
        calculateBridgewaterMacroRiskEngine(
          allSignalsForAnalytics,
          engineState.marketRegime,
          marketCrashProtection,
          account
        );
      engineState.macroRiskState = macroRisk;
      engineState.macroRiskHistory.unshift(macroRisk);
      engineState.macroRiskHistory =
        engineState.macroRiskHistory.slice(0, 200);
      const marketCycleIntelligence =
        calculateAdaptiveMarketCycleIntelligence(
          allSignalsForAnalytics
        );
      engineState.marketCycleIntelligenceState =
        marketCycleIntelligence;
      engineState.marketCycleIntelligenceHistory.unshift(
        marketCycleIntelligence
      );
      engineState.marketCycleIntelligenceHistory =
        engineState.marketCycleIntelligenceHistory.slice(0, 200);
      const liquidityIntelligence =
        calculateLiquidityIntelligenceEngine(
          allSignalsForAnalytics
        );
      engineState.liquidityIntelligenceState =
        liquidityIntelligence;
      engineState.liquidityIntelligenceHistory.unshift(
        liquidityIntelligence
      );
      engineState.liquidityIntelligenceHistory =
        engineState.liquidityIntelligenceHistory.slice(0, 200);
      const correlationIntelligence =
        calculateCorrelationIntelligenceEngine(
          analyticsAiPositions,
          allSignalsForAnalytics
        );
      engineState.correlationIntelligenceState =
        correlationIntelligence;
      engineState.correlationIntelligenceHistory.unshift(
        correlationIntelligence
      );
      engineState.correlationIntelligenceHistory =
        engineState.correlationIntelligenceHistory.slice(0, 200);
      const portfolioGovernor =
        calculateAutonomousPortfolioGovernor(
          account,
          analyticsAiPositions,
          allSignalsForAnalytics,
          engineState.portfolioOptimizationState,
          engineState.macroRiskState,
          marketCrashProtection
        );
      engineState.portfolioGovernorState = portfolioGovernor;
      engineState.portfolioGovernorHistory.unshift(portfolioGovernor);
      engineState.portfolioGovernorHistory =
        engineState.portfolioGovernorHistory.slice(0, 200);
      const selfOptimization =
        calculateAiSelfOptimizationLayer(
          allSignalsForAnalytics
        );
      engineState.selfOptimizationState =
        selfOptimization;
      engineState.selfOptimizationHistory.unshift(
        selfOptimization
      );
      engineState.selfOptimizationHistory =
        engineState.selfOptimizationHistory.slice(0, 200);
      const reinforcementWeights =
        calculateReinforcementLearningWeightEngine(
          allSignalsForAnalytics
        );
      engineState.reinforcementWeightState =
        reinforcementWeights;
      engineState.reinforcementWeightHistory.unshift(
        reinforcementWeights
      );
      engineState.reinforcementWeightHistory =
        engineState.reinforcementWeightHistory.slice(0, 200);
      const executionIntelligence =
        calculateInstitutionalExecutionIntelligence(
          allSignalsForAnalytics,
          analyticsAiPositions
        );
      engineState.executionIntelligenceState =
        executionIntelligence;
      engineState.executionIntelligenceHistory.unshift(
        executionIntelligence
      );
      engineState.executionIntelligenceHistory =
        engineState.executionIntelligenceHistory.slice(0, 200);
      const autonomousTradingSystem =
        calculateFullInstitutionalAutonomousTradingSystem(
          allSignalsForAnalytics
        );
      engineState.autonomousTradingSystemState =
        autonomousTradingSystem;
      engineState.autonomousTradingSystemHistory.unshift(
        autonomousTradingSystem
      );
      engineState.autonomousTradingSystemHistory =
        engineState.autonomousTradingSystemHistory.slice(0, 200);
      const phase20Orchestration =
        calculatePhase20AsyncMultiAgentOrchestration(
          allSignalsForAnalytics
        );
      engineState.phase20AutonomousOrchestrationState =
        phase20Orchestration;
      engineState.phase20AutonomousOrchestrationHistory.unshift(
        phase20Orchestration
      );
      engineState.phase20AutonomousOrchestrationHistory =
        engineState.phase20AutonomousOrchestrationHistory.slice(0, 200);
      const crossEngineMemory =
        calculateCrossEngineMemoryEvolution(
          allSignalsForAnalytics
        );
      engineState.crossEngineMemoryState = crossEngineMemory;
      engineState.crossEngineMemoryHistory.unshift(
        crossEngineMemory
      );
      engineState.crossEngineMemoryHistory =
        engineState.crossEngineMemoryHistory.slice(0, 200);
      const adaptiveExecutionTiming =
        calculateAdaptiveExecutionTimingIntelligence(
          allSignalsForAnalytics
        );
      engineState.adaptiveExecutionTimingState =
        adaptiveExecutionTiming;
      engineState.adaptiveExecutionTimingHistory.unshift(
        adaptiveExecutionTiming
      );
      engineState.adaptiveExecutionTimingHistory =
        engineState.adaptiveExecutionTimingHistory.slice(0, 200);
      const phase21AutonomousBrain =
        calculatePhase21AutonomousInstitutionalBrain(
          allSignalsForAnalytics
        );
      engineState.phase21AutonomousBrainState =
        phase21AutonomousBrain;
      engineState.phase21AutonomousBrainHistory.unshift(
        phase21AutonomousBrain
      );
      engineState.phase21AutonomousBrainHistory =
        engineState.phase21AutonomousBrainHistory.slice(0, 200);
      const liveAiPerformance =
        calculateLiveAiPerformanceAnalyticsEngine(
          account,
          analyticsAiPositions
        );
      engineState.liveAiPerformanceState = liveAiPerformance;
      engineState.liveAiPerformanceHistory.unshift(liveAiPerformance);
      engineState.liveAiPerformanceHistory =
        engineState.liveAiPerformanceHistory.slice(0, 200);
      const selfHealingScanRecovery =
        calculateSelfHealingScanRecoveryEngine();
      engineState.selfHealingScanState =
        selfHealingScanRecovery;
      const macroProbeOverrideAllowed =
        engineState.macroRiskState?.shouldBlockNewTrades === true &&
        marketCrashProtection.shouldBlockNewTrades !== true &&
        engineState.portfolioGovernorState?.shouldBlockNewTrades !== true &&
        Number(engineState.macroRiskState?.macroStressScore || 0) < 88 &&
        Number(engineState.averageSignalScore || 0) >= 35;
      engineState.macroProbeOverrideState = {
        updatedAt: new Date().toISOString(),
        allowed: macroProbeOverrideAllowed,
        macroStressScore: engineState.macroRiskState?.macroStressScore,
        averageSignalScore: engineState.averageSignalScore,
        marketCrashBlock: marketCrashProtection.shouldBlockNewTrades === true,
        portfolioGovernorBlock:
          engineState.portfolioGovernorState?.shouldBlockNewTrades === true,
        reason: macroProbeOverrideAllowed
          ? "Macro risk high, but controlled probe mode allowed."
          : "Macro risk block remains active.",
      };
      if (
        marketCrashProtection.shouldBlockNewTrades ||
        engineState.portfolioGovernorState?.shouldBlockNewTrades ||
        (
          engineState.macroRiskState?.shouldBlockNewTrades &&
          !macroProbeOverrideAllowed
        )
      ) {
        recordOrder("AUTO_TRADING_BLOCKED_MACRO_RISK", "SYSTEM", {
          marketCrashProtection,
          macroRisk: engineState.macroRiskState,
          macroProbeOverrideState: engineState.macroProbeOverrideState,
        });
      }
      if (macroProbeOverrideAllowed) {
        recordOrder("MACRO_PROBE_OVERRIDE_ALLOWED", "SYSTEM", {
          macroRisk: engineState.macroRiskState,
          macroProbeOverrideState: engineState.macroProbeOverrideState,
        });
      }
      engineState.sectorStrengthHistory =
        engineState.sectorStrengthHistory.slice(0, 200);
      engineState.lastScanDurationMs =
        Date.now() - scanStartedAt;
      engineState.signalQualityHistory.unshift({
        timestamp: new Date().toISOString(),
        averageSignalScore:
          engineState.averageSignalScore,
        signalCount: signals.length,
      });
      engineState.signalQualityHistory =
        engineState.signalQualityHistory.slice(0, 200);
      engineState.marketBreadthHistory.unshift({
        timestamp: new Date().toISOString(),
        breadth: engineState.marketBreadth,
      });
      engineState.marketBreadthHistory =
        engineState.marketBreadthHistory.slice(0, 200);
      engineState.marketMomentumHistory.unshift({
        timestamp: new Date().toISOString(),
        score: engineState.marketMomentumScore,
      });
      engineState.marketMomentumHistory =
        engineState.marketMomentumHistory.slice(0, 200);
      engineState.marketVolatilityHistory.unshift({
        timestamp: new Date().toISOString(),
        volatility: engineState.marketVolatility,
      });
      engineState.marketVolatilityHistory =
        engineState.marketVolatilityHistory.slice(0, 200);
      engineState.institutionalExposureHistory.unshift({
        timestamp: new Date().toISOString(),
        mode: engineState.institutionalExposureMode,
        volatility: engineState.marketVolatility,
        momentum: engineState.marketMomentumScore,
        stress: engineState.marketStressLevel,
      });
      engineState.institutionalExposureHistory =
        engineState.institutionalExposureHistory.slice(0, 200);
      engineState.institutionalWatchlist =
        signals
          .filter((s) => Number(s.score || 0) >= 85)
          .slice(0, 25)
          .map((s) => ({
            symbol: s.symbol,
            score: s.score,
            price: s.current,
            percentChange: s.percentChange,
            institutionalGrade:
              s.institutionalGrade,
            updatedAt: new Date().toISOString(),
          }));
      engineState.analyticsSnapshots.unshift({
        timestamp: new Date().toISOString(),
        marketRegime: engineState.marketRegime,
        institutionalExposureMode:
          engineState.institutionalExposureMode,
        marketStressLevel:
          engineState.marketStressLevel,
        marketMomentumScore:
          engineState.marketMomentumScore,
        marketVolatility:
          engineState.marketVolatility,
        averageSignalScore:
          engineState.averageSignalScore,
        signalCount: signals.length,
        stockSignalCount: stockSignals.length,
        cryptoSignalCount: cryptoSignals.length,
      });
      if (engineState.tradeJournalState) {
        const tradeJournalSnapshot = {
          timestamp: new Date().toISOString(),
          totalClosedTrades:
            engineState.tradeJournalState.totalClosedTrades || 0,
          winningTrades:
            engineState.tradeJournalState.winningTrades || 0,
          losingTrades:
            engineState.tradeJournalState.losingTrades || 0,
          averageProfitPercent:
            engineState.tradeJournalState.averageProfitPercent || 0,
          winRate:
            engineState.tradeJournalState.winRate || 0,
        };
        engineState.analyticsSnapshots.unshift({
          type: "TRADE_JOURNAL_ANALYTICS",
          ...tradeJournalSnapshot,
        });
      }
      engineState.analyticsSnapshots =
        engineState.analyticsSnapshots.slice(0, 300);
      saveEngineState("SCAN_COMPLETED");
      const marketStressLocked =
        engineState.marketStressLevel >= 25;
      const volatilityLocked =
        engineState.marketVolatility >= 18;
      const portfolioRefreshAccount =
        engineState.cachedAccount || account;
      const portfolioRefreshPositions =
        Array.isArray(engineState.cachedPositions)
          ? engineState.cachedPositions.filter((position) => {
            const symbol = normalizeSymbol(position.symbol);
            if (!symbol) return false;
            if (
              Array.isArray(engineState.aiManagedSymbols) &&
              engineState.aiManagedSymbols.includes(symbol)
            ) {
              return true;
            }
            return String(position.asset_class || "").toLowerCase() === "us_equity";
          })
          : [];
      for (const signal of stockSignals) {
        if (
          !signal.institutionalExecutionPlan &&
          typeof calculateInstitutionalExecutionPlan === "function"
        ) {
          const refreshExecutionPlan =
            calculateInstitutionalExecutionPlan(signal, 0);
          signal.institutionalExecutionPlan = refreshExecutionPlan;
          signal.executionConfidence =
            refreshExecutionPlan.executionConfidence;
        }
        const refreshedPortfolioManager =
          calculateAiPortfolioManagerDecision(
            signal,
            portfolioRefreshAccount,
            portfolioRefreshPositions,
            engineState.marketRegime || detectMarketRegime(stockSignals)
          );
        const penaltyCompressionApproval =
          signal.penaltyCompression?.shouldRestoreApproval === true;
        const protectedPenaltyCompressionDecision =
          penaltyCompressionApproval
            ? {
              autoTradeApproved: signal.autoTradeApproved,
              approved: signal.approved,
              decisionLevel: signal.decisionLevel,
              portfolioAction: signal.portfolioAction,
              aiPortfolioAction: signal.aiPortfolioAction,
              allocationMultiplier: signal.allocationMultiplier,
            }
            : null;
        Object.assign(signal, refreshedPortfolioManager);
        if (protectedPenaltyCompressionDecision) {
          Object.assign(signal, protectedPenaltyCompressionDecision);
          signal.finalApprovalProtection = {
            phase: "58_FINAL_APPROVAL_RECONCILIATION",
            protected: true,
            reason:
              "Penalty compression restored approval; later portfolio refresh was not allowed to overwrite it.",
          };
        }
        const finalSizingReconciliation =
          calculateFinalPositionSizingReconciliation({
            signal,
            account,
            managedPositions,
            portfolioGovernor: engineState.portfolioGovernorState || {},
            portfolioManager: refreshedPortfolioManager,
            institutionalExecutionPlan:
              signal.institutionalExecutionPlan || {},
            capitalPressure:
              signal.autonomousCapitalPressure || {},
            baseTradeAmount:
              signal.recommendedTradeAmount || 0,
          });
        signal.finalSizingReconciliation = finalSizingReconciliation;
        signal.recommendedTradeAmount =
          finalSizingReconciliation.finalTradeAmount;
        signal.finalApprovedTradeAmount =
          finalSizingReconciliation.finalTradeAmount;
        signal.displayTradeAmount =
          finalSizingReconciliation.finalTradeAmount;
        signal.aiAllocationPercentOfBotBudget =
          finalSizingReconciliation.maxBotBudget > 0
            ? Number(
              (
                finalSizingReconciliation.finalTradeAmount /
                finalSizingReconciliation.maxBotBudget *
                100
              ).toFixed(2)
            )
            : 0;
        if (
          finalSizingReconciliation.finalBlocked &&
          signal.finalApprovalProtection?.protected !== true
        ) {
          signal.autoTradeApproved = false;
          signal.approved = false;
          signal.decisionLevel = "Blocked By Final Sizing Reconciliation";
          signal.portfolioAction = "FINAL_SIZE_BLOCK";
          signal.aiPortfolioAction = "FINAL_SIZE_BLOCK";
        }
        const finalStockExecutionGate = evaluateStockTradeCandidate(signal, {
          requireCentralDecision: true,
          maxQuoteAgeSeconds: Number(
            getRuntime()?.LIVE_ORDER_MAX_QUOTE_AGE_SECONDS ||
            15
          ),
          maxSpreadPercent: Number(
            getRuntime()?.LIVE_ORDER_MAX_SPREAD_PERCENT ||
            1
          ),
        });
        signal.finalStockExecutionGate = finalStockExecutionGate;
        signal.finalEntryEvidenceGate = finalStockExecutionGate;
        if (!finalStockExecutionGate.approved) {
          signal.qualifiedToBuy = false;
          signal.autoTradeApproved = false;
          signal.approved = false;
          signal.recommendedTradeAmount = 0;
          signal.finalApprovedTradeAmount = 0;
          signal.displayTradeAmount = 0;
          signal.aiAllocationPercentOfBotBudget = 0;
          signal.decisionLevel = `Watch Only - ${finalStockExecutionGate.reasons.join(", ")}`;
        } else {
          signal.qualifiedToBuy = true;
          signal.autoTradeApproved = true;
          signal.approved = true;
        }
      }
      signals = [...stockSignals, ...cryptoSignals];
      const finalFullInstitutionalAiBrain =
        calculateFullInstitutionalAiBrain(signals);
      engineState.fullInstitutionalAiBrainState =
        finalFullInstitutionalAiBrain;
      engineState.fullInstitutionalAiBrainHistory.unshift(
        finalFullInstitutionalAiBrain
      );
      engineState.fullInstitutionalAiBrainHistory =
        engineState.fullInstitutionalAiBrainHistory.slice(0, 200);
      const finalAutonomousTradingSystem =
        calculateFullInstitutionalAutonomousTradingSystem(
          signals
        );
      engineState.autonomousTradingSystemState =
        finalAutonomousTradingSystem;
      engineState.autonomousTradingSystemHistory.unshift(
        finalAutonomousTradingSystem
      );
      engineState.autonomousTradingSystemHistory =
        engineState.autonomousTradingSystemHistory.slice(0, 200);
      const finalPhase20Orchestration =
        calculatePhase20AsyncMultiAgentOrchestration(
          signals
        );
      engineState.phase20AutonomousOrchestrationState =
        finalPhase20Orchestration;
      engineState.phase20AutonomousOrchestrationHistory.unshift(
        finalPhase20Orchestration
      );
      engineState.phase20AutonomousOrchestrationHistory =
        engineState.phase20AutonomousOrchestrationHistory.slice(0, 200);
      const finalPhase21AutonomousBrain =
        calculatePhase21AutonomousInstitutionalBrain(
          signals
        );
      engineState.phase21AutonomousBrainState =
        finalPhase21AutonomousBrain;
      engineState.phase21AutonomousBrainHistory.unshift(
        finalPhase21AutonomousBrain
      );
      engineState.phase21AutonomousBrainHistory =
        engineState.phase21AutonomousBrainHistory.slice(0, 200);
      stockSignals = syncSignalObjectsBySymbol(
        stockSignals,
        signals
      );
      cryptoSignals = syncSignalObjectsBySymbol(
        cryptoSignals,
        signals
      );
      signals = [...stockSignals, ...cryptoSignals];
      const finalDashboardSignalSync =
        syncFinalInstitutionalDashboardSignals(
          stockSignals,
          cryptoSignals
        );
      engineState.finalDashboardSignalSyncState =
        finalDashboardSignalSync;
      if (!Array.isArray(engineState.finalDashboardSignalSyncHistory)) {
        engineState.finalDashboardSignalSyncHistory = [];
      }
      engineState.finalDashboardSignalSyncHistory.unshift(
        finalDashboardSignalSync
      );
      engineState.finalDashboardSignalSyncHistory =
        engineState.finalDashboardSignalSyncHistory.slice(0, 200);
      recordOrder("FINAL_DASHBOARD_SIGNAL_SYNC_UPDATED", "DASHBOARD", {
        reviewedCount: finalDashboardSignalSync.reviewedCount || 0,
        stockSignalCount:
          finalDashboardSignalSync.stockSignalCount || 0,
        cryptoSignalCount:
          finalDashboardSignalSync.cryptoSignalCount || 0,
        topSymbols:
          finalDashboardSignalSync.topSymbols || [],
      });
      signals = signals.map((signal) => ({
        ...signal,
        score: clampScore(signal.score),
        runnerScore: clampScore(signal.runnerScore),
        explosiveRunnerScore: clampScore(signal.explosiveRunnerScore),
        fastRunnerScore: clampScore(signal.fastRunnerScore),
        quickInstitutionalScore: clampScore(signal.quickInstitutionalScore),
        aiConfidence: clampScore(signal.aiConfidence),
        autonomousConfidenceScore: clampScore(signal.autonomousConfidenceScore),
      }));
      stockSignals = stockSignals.map((signal) => ({
        ...signal,
        score: clampScore(signal.score),
        runnerScore: clampScore(signal.runnerScore),
        explosiveRunnerScore: clampScore(signal.explosiveRunnerScore),
        fastRunnerScore: clampScore(signal.fastRunnerScore),
        quickInstitutionalScore: clampScore(signal.quickInstitutionalScore),
        swingScore: clampScore(signal.swingScore),
        swingConfidence: clampScore(signal.swingConfidence),
        aiConfidence: clampScore(signal.aiConfidence),
        autonomousConfidenceScore: clampScore(signal.autonomousConfidenceScore),
      }));
      cryptoSignals = cryptoSignals.map((signal) => ({
        ...signal,
        score: clampScore(signal.score),
        runnerScore: clampScore(signal.runnerScore),
        explosiveRunnerScore: clampScore(signal.explosiveRunnerScore),
        fastRunnerScore: clampScore(signal.fastRunnerScore),
        quickInstitutionalScore: clampScore(signal.quickInstitutionalScore),
        aiConfidence: clampScore(signal.aiConfidence),
        autonomousConfidenceScore: clampScore(signal.autonomousConfidenceScore),
      }));
      const outcomeNow = Date.now();
      const priorFollowupState =
        engineState.stockScoreOutcomeFollowupState || { lastAttemptBySymbol: {} };
      const dueOutcomeSymbols = getDueStockOutcomeSymbols(
        engineState.stockScoreOutcomeState,
        stockSignals,
        {
          now: outcomeNow,
          maxSymbols: 20,
          lastAttemptBySymbol: priorFollowupState.lastAttemptBySymbol,
        }
      );
      let outcomeFollowupSignals = [];
      if (dueOutcomeSymbols.length > 0) {
        try {
          outcomeFollowupSignals = await getStockOutcomeFollowupQuotes(
            dueOutcomeSymbols
          );
        } catch (error) {
          recordOrder("STOCK_OUTCOME_FOLLOWUP_QUOTE_FAILED", "MARKET", {
            requestedCount: dueOutcomeSymbols.length,
            error: error?.message || String(error),
          });
        }
      }
      const nextAttemptsBySymbol = {
        ...(priorFollowupState.lastAttemptBySymbol || {}),
      };
      for (const symbol of dueOutcomeSymbols) {
        nextAttemptsBySymbol[symbol] = outcomeNow;
      }
      const nextAttemptEntries = Object.entries(nextAttemptsBySymbol)
        .sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0))
        .slice(0, 100);
      engineState.stockScoreOutcomeFollowupState = {
        updatedAt: new Date(outcomeNow).toISOString(),
        requestedSymbols: dueOutcomeSymbols,
        receivedCount: outcomeFollowupSignals.length,
        retryDelayMinutes: 15,
        lastAttemptBySymbol: Object.fromEntries(nextAttemptEntries),
      };
      engineState.stockScoreOutcomeState = updateStockScoreOutcomes(
        engineState.stockScoreOutcomeState,
        [...stockSignals, ...outcomeFollowupSignals],
        { now: outcomeNow }
      );
      engineState.stockScoreOutcomeSummary =
        engineState.stockScoreOutcomeState.summary;
      engineState.stockScoreOutcomeLearning =
        calculateStockOutcomeLearning(engineState.stockScoreOutcomeState);
      engineState.lastSignals = signals;
      engineState.lastStockSignals =
        Array.isArray(stockSignals) && stockSignals.length > 0
          ? stockSignals
          : Array.isArray(engineState.lastStockSignals)
            ? engineState.lastStockSignals
            : [];
      engineState.lastCryptoSignals =
        Array.isArray(cryptoSignals) && cryptoSignals.length > 0
          ? cryptoSignals
          : Array.isArray(engineState.lastCryptoSignals)
            ? engineState.lastCryptoSignals
            : [];
      engineState.topSignals = [...engineState.lastStockSignals, ...engineState.lastCryptoSignals]
        .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
        .slice(0, CONFIG.maxSignalsToReturn || 75);
      engineState.topStockSignals = [...engineState.lastStockSignals]
        .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
        .slice(0, 25);
      engineState.topSwingWatchlist =
        Array.isArray(engineState.topSwingWatchlist) &&
          engineState.topSwingWatchlist.length > 0
          ? engineState.topSwingWatchlist.slice(0, 25)
          : [...(engineState.lastStockSignals || [])]
            .filter((signal) => Number(signal.swingScore || 0) >= 65)
            .sort((a, b) => Number(b.swingScore || 0) - Number(a.swingScore || 0))
            .slice(0, 25);
  
      engineState.highConfidenceSwingStocks =
        Array.isArray(engineState.highConfidenceSwingStocks) &&
          engineState.highConfidenceSwingStocks.length > 0
          ? engineState.highConfidenceSwingStocks.slice(0, 10)
          : [...(engineState.lastStockSignals || [])]
            .filter((signal) => signal.highConfidenceSwing === true)
            .sort((a, b) => Number(b.swingScore || 0) - Number(a.swingScore || 0))
            .slice(0, 10);
  
      engineState.topCryptoSignals = [...engineState.lastCryptoSignals]
        .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
        .slice(0, 25);
      pushLiveSignalUpdate(
        buildLiveSignalPushPayload()
      );
      refreshFinnhubLiveSubscriptions();
      if (
        ENABLE_POLYGON_WEBSOCKET &&
        typeof refreshPolygonLiveSubscriptions === "function"
      ) {
        refreshEarlyMoversThenPolygonSubscriptions();
      }
      const approvedStockSignals = stockSignals.filter(
        (signal) =>
          signal.finalStockExecutionGate?.approved === true
      );
      const approvedCryptoSignals = cryptoSignals.filter(
        (signal) =>
          signal.qualifiedToBuy === true &&
          signal.autoTradeApproved !== false &&
          Number(signal.score || 0) >= CONFIG.minScoreToBuy
      );
      effectiveMode = selectSmartTradingMode({
        selectedMode: TRADING_MODE,
        currentEffectiveMode: effectiveMode,
        stockSignals,
        cryptoSignals,
      });
      engineState.effectiveMode = effectiveMode;
      const { shouldRunStockAutoBuy, shouldRunCryptoAutoBuy } =
        buildStrategyExecutionPlan({
          selectedMode: TRADING_MODE,
          effectiveMode,
          marketOpen,
          approvedStockCount: approvedStockSignals.length,
          approvedCryptoCount: approvedCryptoSignals.length,
          tradingStoppedForDay,
          stockTradingStoppedForDay: engineState.stockTradingStoppedForDay,
          cryptoTradingStoppedForDay: engineState.cryptoTradingStoppedForDay,
        });
      if (
        autoTradingEnabled &&
        !engineState.dailyLossLocked &&
        !engineState.profitLocked &&
        !riskLocked
      ) {
        if (shouldRunStockAutoBuy) {
          await autoBuySignals(stockSignals);
          engineState.aiDecisionHistory.unshift({
            timestamp: new Date().toISOString(),
            type: marketOpen
              ? "AUTO_STOCK_BUY_EXECUTED"
              : "AUTO_STOCK_BUY_EXTENDED_HOURS_EXECUTED",
            signalCount: stockSignals.length,
            approvedSignalCount: approvedStockSignals.length,
            tradingMode: TRADING_MODE,
            effectiveMode,
            marketOpen,
          });
          engineState.aiDecisionHistory =
            engineState.aiDecisionHistory.slice(0, 300);
        }
        if (shouldRunCryptoAutoBuy) {
          await autoBuyCryptoSignals(cryptoSignals);
          engineState.aiDecisionHistory.unshift({
            timestamp: new Date().toISOString(),
            type: "AUTO_CRYPTO_BUY_EXECUTED",
            signalCount: cryptoSignals.length,
            approvedSignalCount: approvedCryptoSignals.length,
            tradingMode: TRADING_MODE,
            effectiveMode,
            marketOpen,
          });
          engineState.aiDecisionHistory =
            engineState.aiDecisionHistory.slice(0, 300);
        }
        if (!shouldRunStockAutoBuy && !shouldRunCryptoAutoBuy) {
          recordOrder("AUTO_BUY_SKIPPED_NO_APPROVED_SIGNALS", "ALL", {
            stockApprovedCount: approvedStockSignals.length,
            cryptoApprovedCount: approvedCryptoSignals.length,
            tradingMode: TRADING_MODE,
            effectiveMode,
            marketOpen,
          });
        }
      }
      if (
        autoTradingEnabled &&
        !marketOpen &&
        !shouldRunStockAutoBuy &&
        !shouldRunCryptoAutoBuy
      ) {
        recordOrder("BUY_SKIPPED_NO_APPROVED_EXTENDED_HOURS_SIGNAL", "ALL", {
          message:
            "Market closed, but extended-hours stock buying is allowed when approved stock signals exist.",
        });
      }
  }

  return { executeEngineCycleBody };
}
