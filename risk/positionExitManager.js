export function createPositionExitManager(dependencies) {
  const {
    CONFIG,
    addPendingExit,
    calculateAdaptiveOvernightHoldIntelligence,
    calculateContinuationHoldExitDecision,
    calculateCoreExitTriggers,
    calculateExitParliamentConsensus,
    calculateExplosiveRunnerHoldDecision,
    calculateInstitutionalDistributionClimax,
    calculateInstitutionalExitOrchestrator,
    calculateInstitutionalProfitExtraction,
    calculateInstitutionalReloadIntelligence,
    calculateMorningProfitLockDecision,
    calculateOvernightHoldRiskGate,
    calculatePdtExitProtection,
    calculateRunnerExitDelayGate,
    calculateSmartExitIntelligence,
    calculateSmartSwingConversionEngine,
    calculateSmartTrimDecision,
    calculateSwingRisk,
    calculateTrendPersistenceHoldDecision,
    calculateTrendQualityHoldDuration,
    calculateWeakSetupFastExitGate,
    engineState,
    getBotOwnedSymbols,
    getExitReinforcementAdjustment,
    getPositions,
    isAiManagedOpenPosition,
    journalTradeExit,
    normalizeSymbol,
    placeCryptoMarketSell,
    placeMarketSell,
    recordFailedOrder,
    recordOrder,
    rememberTradeResult,
    saveEngineState,
    updateExitDashboardState,
    updateReloadReentryMemory,
    getTradingMode,
  } = dependencies;

  async function autoExitPositions(marketOpen) {
    const positions = engineState.cachedPositions || (await getPositions());
    const aiOwnedSymbols = await getBotOwnedSymbols();
    for (const pos of positions) {
      const symbol = normalizeSymbol(pos.symbol);
      if (symbol.includes("/") || symbol.endsWith("USD")) continue;
      if (!isAiManagedOpenPosition(pos, aiOwnedSymbols)) continue;
      const qty = Number(pos.qty);
      const currentPrice = Number(pos.current_price);
      const unrealizedPercent = Number(pos.unrealized_plpc) * 100;
      if (!qty || !currentPrice) continue;
      const previousHigh = Number(engineState.highWaterMarks[symbol] || 0);
      const highWater = Math.max(previousHigh, currentPrice);
      engineState.highWaterMarks[symbol] = highWater;
      const dropFromHigh =
        highWater > 0 ? ((highWater - currentPrice) / highWater) * 100 : 0;
      const adaptiveSwingRisk = calculateSwingRisk(
        {
          symbol,
          current: currentPrice,
          price: currentPrice,
          high: highWater,
          low: Number(pos.avg_entry_price || currentPrice),
          score: engineState.aiEntryScores?.[symbol]?.score || 0,
          technicalScore:
            engineState.aiEntryScores?.[symbol]?.technicalScore || 0,
          statisticalScore:
            engineState.aiEntryScores?.[symbol]?.statisticalScore || 0,
          trendPersistenceScore:
            engineState.trendPersistenceState?.heldSymbols?.[symbol]
              ?.trendPersistenceScore || 0,
          percentChange: unrealizedPercent,
          assetType: "stock",
        },
        { assetType: "stock" }
      );
      const alreadyRunner = Boolean(engineState.runnerPositions[symbol]);
      const shouldActivateRunner =
        unrealizedPercent >=
        Math.max(
          CONFIG.runnerTriggerPercent,
          adaptiveSwingRisk.takeProfitPercent * 0.7
        );
      if (shouldActivateRunner && !alreadyRunner) {
        engineState.runnerPositions[symbol] = {
          activatedAt: new Date().toISOString(),
          activatedProfitPercent: unrealizedPercent,
          activatedPrice: currentPrice,
          highWater,
        };
        recordOrder("RUNNER_ACTIVATED", symbol, {
          dynamicRunnerTrailingStopPercent:
            unrealizedPercent >= 15
              ? 2
              : unrealizedPercent >= 10
                ? 1.5
                : CONFIG.runnerTrailingStopPercent,
          qty,
          price: currentPrice,
          profitPercent: unrealizedPercent,
          runnerTriggerPercent: CONFIG.runnerTriggerPercent,
          runnerTrailingStopPercent: CONFIG.runnerTrailingStopPercent,
        });
      }
      const isRunner = Boolean(engineState.runnerPositions[symbol]);
      const profitExtraction =
        calculateInstitutionalProfitExtraction({
          symbol,
          unrealizedPercent,
          dropFromHigh,
          isRunner,
          highWater,
          currentPrice,
        });
      engineState.institutionalExitOrchestratorState = {
        ...(engineState.institutionalExitOrchestratorState || {}),
        latestProfitExtraction: profitExtraction,
        updatedAt: new Date().toISOString(),
      };
      const preliminaryExitTriggers = calculateCoreExitTriggers({
        unrealizedPercent,
        dropFromHigh,
        isRunner,
        stopLossPercent: adaptiveSwingRisk.stopLossPercent,
        trailingStopPercent: adaptiveSwingRisk.trailingStopPercent,
        runnerTrailingStopPercent: CONFIG.runnerTrailingStopPercent,
      });
      const shouldStopLoss = preliminaryExitTriggers.shouldStopLoss;
      const continuationHoldExitDecision =
        calculateContinuationHoldExitDecision({
          symbol,
          unrealizedPercent,
          dropFromHigh,
        });
      const isMorningStrikePosition =
        engineState.aiEntryScores?.[symbol]?.entryType === "MORNING_STRIKE" ||
        engineState.aiEntryScores?.[symbol]?.morningStrike === true ||
        engineState.morningStrikeState?.selectedSymbols?.some(
          (selectedSymbol) =>
            normalizeSymbol(selectedSymbol) === symbol
        );
      const morningProfitLockDecision =
        calculateMorningProfitLockDecision({
          symbol,
          unrealizedPercent,
          dropFromHigh,
          isMorningStrike: isMorningStrikePosition,
        });
      const shouldProtectProfit = preliminaryExitTriggers.shouldProtectProfit;
      const shouldNormalTrailingExit = preliminaryExitTriggers.shouldNormalTrailingExit;
      const trendQualityHold =
        calculateTrendQualityHoldDuration({
          symbol,
          score: engineState.aiEntryScores?.[symbol]?.score || 0,
          technicalScore:
            engineState.aiEntryScores?.[symbol]?.technicalScore || 0,
          statisticalScore:
            engineState.aiEntryScores?.[symbol]?.statisticalScore || 0,
          trendPersistenceScore:
            engineState.trendPersistenceState?.heldSymbols?.[symbol]
              ?.trendPersistenceScore || 0,
          unrealizedPercent,
          dropFromHigh,
        });
      const trendHoldDecision =
        calculateTrendPersistenceHoldDecision({
          unrealizedPercent,
          dropFromHigh,
          isRunner,
          highWater,
          currentPrice,
        });
      const dynamicRunnerTrailingStopPercent = Math.max(
        Number(
          trendHoldDecision.runnerTrailingStopPercent ||
          CONFIG.runnerTrailingStopPercent
        ),
        Number(
          profitExtraction.dynamicRunnerTrailingStopPercent ||
          CONFIG.runnerTrailingStopPercent
        )
      );
      const smartExitDecision =
        calculateSmartExitIntelligence({
          symbol,
          unrealizedPercent,
          dropFromHigh,
          isRunner,
          isContinuationHold:
            normalizeSymbol(engineState.activeContinuationHoldSymbol) === symbol,
          trendQualityHold,
          trendHoldDecision,
          adaptiveSwingRisk,
        });
      engineState.smartExitIntelligenceState = smartExitDecision;
      engineState.smartExitIntelligenceHistory.unshift({
        ...smartExitDecision,
        updatedAt: new Date().toISOString(),
      });
      engineState.smartExitIntelligenceHistory =
        engineState.smartExitIntelligenceHistory.slice(0, 200);
      const institutionalExitDecision =
        calculateInstitutionalExitOrchestrator({
          symbol,
          qty,
          unrealizedPercent,
          dropFromHigh,
          isRunner,
          smartExitDecision,
          trendHoldDecision,
          continuationHoldExitDecision,
          adaptiveSwingRisk,
        });
      engineState.institutionalExitOrchestratorState =
        institutionalExitDecision;
      engineState.institutionalExitOrchestratorHistory.unshift({
        ...institutionalExitDecision,
        updatedAt: new Date().toISOString(),
      });
      engineState.institutionalExitOrchestratorHistory =
        engineState.institutionalExitOrchestratorHistory.slice(0, 200);
      const distributionClimaxDecision =
        calculateInstitutionalDistributionClimax({
          symbol,
          unrealizedPercent,
          dropFromHigh,
          isRunner,
          smartExitDecision,
          institutionalExitDecision,
        });
      engineState.institutionalDistributionState =
        distributionClimaxDecision;
      engineState.institutionalDistributionHistory.unshift({
        ...distributionClimaxDecision,
        updatedAt: new Date().toISOString(),
      });
      engineState.institutionalDistributionHistory =
        engineState.institutionalDistributionHistory.slice(0, 200);
      const institutionalReloadDecision =
        calculateInstitutionalReloadIntelligence({
          symbol,
          unrealizedPercent,
          dropFromHigh,
          distributionClimaxDecision,
          institutionalExitDecision,
        });
      engineState.institutionalReloadState =
        institutionalReloadDecision;
      engineState.institutionalReloadHistory.unshift({
        ...institutionalReloadDecision,
        updatedAt: new Date().toISOString(),
      });
      engineState.institutionalReloadHistory =
        engineState.institutionalReloadHistory.slice(0, 200);
      const adaptiveOvernightHoldDecision =
        calculateAdaptiveOvernightHoldIntelligence({
          symbol,
          unrealizedPercent,
          dropFromHigh,
          isRunner,
          smartExitDecision,
          institutionalExitDecision,
          distributionClimaxDecision,
          institutionalReloadDecision,
        });
      engineState.adaptiveOvernightHoldState =
        adaptiveOvernightHoldDecision;
      engineState.adaptiveOvernightHoldHistory.unshift({
        ...adaptiveOvernightHoldDecision,
        updatedAt: new Date().toISOString(),
      });
      engineState.adaptiveOvernightHoldHistory =
        engineState.adaptiveOvernightHoldHistory.slice(0, 200);
      const smartSwingConversionDecision =
        calculateSmartSwingConversionEngine({
          symbol,
          unrealizedPercent,
          dropFromHigh,
          isRunner,
          smartExitDecision,
          institutionalExitDecision,
          distributionClimaxDecision,
          institutionalReloadDecision,
          adaptiveOvernightHoldDecision,
        });
      engineState.smartSwingConversionState =
        smartSwingConversionDecision;
      engineState.smartSwingConversionHistory.unshift({
        ...smartSwingConversionDecision,
        updatedAt: new Date().toISOString(),
      });
      engineState.smartSwingConversionHistory =
        engineState.smartSwingConversionHistory.slice(0, 200);
      const latestSignalForRunnerHold =
        (engineState.lastSignals || []).find(
          (signal) => normalizeSymbol(signal.symbol) === symbol
        ) || {};
      const explosiveRunnerHoldDecision =
        calculateExplosiveRunnerHoldDecision({
          symbol,
          position: pos,
          signal: {
            ...latestSignalForRunnerHold,
            ...(engineState.aiEntryScores?.[symbol] || {}),
            price: currentPrice,
            currentPrice,
            score:
              latestSignalForRunnerHold.score ||
              engineState.aiEntryScores?.[symbol]?.score ||
              0,
            runnerScore:
              latestSignalForRunnerHold.runnerScore ||
              latestSignalForRunnerHold.explosiveRunnerScore ||
              latestSignalForRunnerHold.explosiveRunnerPrediction?.explosiveRunnerScore ||
              engineState.aiEntryScores?.[symbol]?.runnerScore ||
              engineState.aiEntryScores?.[symbol]?.explosiveRunnerScore ||
              0,
            trendPersistenceScore:
              latestSignalForRunnerHold.trendPersistenceScore ||
              engineState.trendPersistenceState?.heldSymbols?.[symbol]
                ?.trendPersistenceScore ||
              0,
          },
        });
      const shouldRunnerTrailingExit = calculateCoreExitTriggers({
        unrealizedPercent,
        dropFromHigh,
        isRunner,
        stopLossPercent: adaptiveSwingRisk.stopLossPercent,
        trailingStopPercent: adaptiveSwingRisk.trailingStopPercent,
        runnerTrailingStopPercent: dynamicRunnerTrailingStopPercent,
        explosiveRunnerHold: explosiveRunnerHoldDecision.shouldHold,
      }).shouldRunnerTrailingExit;
      const exitParliamentDecision =
        calculateExitParliamentConsensus({
          symbol,
          unrealizedPercent,
          dropFromHigh,
          shouldStopLoss,
          shouldProtectProfit,
          shouldNormalTrailingExit,
          shouldRunnerTrailingExit,
          smartExitDecision,
          institutionalExitDecision,
          distributionClimaxDecision,
          adaptiveOvernightHoldDecision,
          smartSwingConversionDecision,
          explosiveRunnerHoldDecision,
          phase7Reinforcement:
            engineState.aiEntryScores?.[symbol]?.phase7Reinforcement || {},
        });
      engineState.exitParliamentState = exitParliamentDecision;
      engineState.exitParliamentHistory.unshift({
        ...exitParliamentDecision,
        updatedAt: new Date().toISOString(),
      });
      engineState.exitParliamentHistory =
        engineState.exitParliamentHistory.slice(0, 200);
      if (
        (
          trendHoldDecision.shouldHold ||
          trendQualityHold.shouldExtendHold ||
          continuationHoldExitDecision.shouldProtectHold ||
          smartExitDecision.shouldExtendHold ||
          institutionalExitDecision.shouldHold ||
          adaptiveOvernightHoldDecision.shouldHoldOvernight ||
          smartSwingConversionDecision.shouldProtectSwing ||
          explosiveRunnerHoldDecision.shouldHold ||
          exitParliamentDecision.shouldConsensusHold
        ) &&
        !shouldStopLoss &&
        !continuationHoldExitDecision.shouldExit &&
        !smartExitDecision.shouldForceExit &&
        !institutionalExitDecision.shouldForceExit &&
        !distributionClimaxDecision.shouldExitClimax &&
        !adaptiveOvernightHoldDecision.shouldExitBeforeClose &&
        !(
          smartSwingConversionDecision.shouldProtectSwing &&
          !shouldStopLoss
        ) &&
        !exitParliamentDecision.shouldConsensusExit
      ) {
        recordOrder("SMART_EXIT_HOLD", symbol, {
          qty,
          price: currentPrice,
          highWater,
          dropFromHigh,
          profitPercent: unrealizedPercent,
          isRunner,
          smartExitDecision,
          exitParliamentDecision,
          explosiveRunnerHoldDecision,
          profitExtraction,
          trendHoldMode: trendHoldDecision.mode,
          trendHoldReason: trendHoldDecision.reason,
          dynamicRunnerTrailingStopPercent,
        });
        continue;
      }
      const pdtTrimProtection =
        calculatePdtExitProtection({
          symbol,
          account: engineState.cachedAccount || {},
          reason: "PARTIAL_TRIM",
          qty,
          exitType: "PARTIAL_TRIM",
          shouldStopLoss,
          exitParliamentDecision,
        });
      if (pdtTrimProtection.shouldDeferExit) {
        addPendingExit(symbol, qty, "PDT_DEFERRED_TRIM", {
          price: currentPrice,
          highWater,
          dropFromHigh,
          profitPercent: unrealizedPercent,
          pdtTrimProtection,
        });
        recordOrder("PDT_TRIM_DEFERRED", symbol, {
          qty,
          price: currentPrice,
          profitPercent: unrealizedPercent,
          pdtTrimProtection,
        });
        saveEngineState("PDT_TRIM_DEFERRED");
        continue;
      }
      if (
        adaptiveOvernightHoldDecision.shouldTrimBeforeClose &&
        marketOpen &&
        qty >= 2
      ) {
        try {
          const overnightTrimQty = Math.max(1, Math.floor(qty * 0.25));
          const overnightTrimOrder = await placeMarketSell(
            symbol,
            overnightTrimQty,
            "OVERNIGHT_RISK_TRIM"
          );
          recordOrder("OVERNIGHT_RISK_TRIM", symbol, {
            overnightTrimQty,
            remainingQty: qty - overnightTrimQty,
            price: currentPrice,
            profitPercent: unrealizedPercent,
            dropFromHigh,
            adaptiveOvernightHoldDecision,
            overnightTrimOrder,
          });
          saveEngineState("OVERNIGHT_RISK_TRIM");
          continue;
        } catch (err) {
          recordFailedOrder("OVERNIGHT_RISK_TRIM_FAILED", symbol, err.message, {
            qty,
            price: currentPrice,
            profitPercent: unrealizedPercent,
            adaptiveOvernightHoldDecision,
          });
        }
      }
      if (
        distributionClimaxDecision.shouldTrimClimax &&
        marketOpen &&
        qty >= 2
      ) {
        try {
          const trimQty = Math.max(1, Math.floor(qty * 0.25));
          const trimOrder = await placeMarketSell(
            symbol,
            trimQty,
            "CLIMAX_TRIM_PROFIT"
          );
          recordOrder("CLIMAX_TRIM_PROFIT", symbol, {
            trimQty,
            remainingQty: qty - trimQty,
            price: currentPrice,
            profitPercent: unrealizedPercent,
            dropFromHigh,
            distributionClimaxDecision,
            institutionalReloadDecision,
            trimOrder,
          });
          saveEngineState("CLIMAX_TRIM_PROFIT");
          continue;
        } catch (err) {
          recordFailedOrder("CLIMAX_TRIM_FAILED", symbol, err.message, {
            qty,
            price: currentPrice,
            profitPercent: unrealizedPercent,
            distributionClimaxDecision,
          });
        }
      }
      if (
        institutionalExitDecision.shouldScaleProfit &&
        marketOpen &&
        qty >= 2
      ) {
        try {
          const scaleQty = Math.max(
            1,
            Math.floor(qty * institutionalExitDecision.scalePercent)
          );
          const scaleOrder = await placeMarketSell(
            symbol,
            scaleQty,
            institutionalExitDecision.scaleLevel
          );
          engineState.runnerPositions[symbol] = {
            ...(engineState.runnerPositions[symbol] || {}),
            institutionalExitLadder: {
              ...(engineState.runnerPositions[symbol]?.institutionalExitLadder || {}),
              firstScaleTaken:
                institutionalExitDecision.scaleLevel === "FIRST_SCALE"
                  ? true
                  : engineState.runnerPositions[symbol]?.institutionalExitLadder?.firstScaleTaken || false,
              secondScaleTaken:
                institutionalExitDecision.scaleLevel === "SECOND_SCALE"
                  ? true
                  : engineState.runnerPositions[symbol]?.institutionalExitLadder?.secondScaleTaken || false,
              lastScaleTakenAt: new Date().toISOString(),
              lastScaleProfitPercent: unrealizedPercent,
              lastScaleQty: scaleQty,
            },
          };
          recordOrder("INSTITUTIONAL_PROFIT_SCALE_OUT", symbol, {
            scaleQty,
            remainingQty: qty - scaleQty,
            price: currentPrice,
            profitPercent: unrealizedPercent,
            dropFromHigh,
            institutionalExitDecision,
            scaleOrder,
          });
          saveEngineState("INSTITUTIONAL_PROFIT_SCALE_OUT");
          continue;
        } catch (err) {
          recordFailedOrder("INSTITUTIONAL_PROFIT_SCALE_FAILED", symbol, err.message, {
            qty,
            price: currentPrice,
            profitPercent: unrealizedPercent,
            dropFromHigh,
            institutionalExitDecision,
          });
        }
      }
      if (
        smartExitDecision.shouldPartialProfit &&
        marketOpen &&
        qty >= 2
      ) {
        try {
          const partialQty = Math.max(1, Math.floor(qty * 0.5));
          const partialOrder = await placeMarketSell(
            symbol,
            partialQty,
            "SMART_PARTIAL_PROFIT"
          );
          engineState.runnerPositions[symbol] = {
            ...(engineState.runnerPositions[symbol] || {}),
            partialProfitTaken: true,
            partialProfitTakenAt: new Date().toISOString(),
            partialProfitPercent: unrealizedPercent,
            partialProfitQty: partialQty,
          };
          recordOrder("SMART_PARTIAL_PROFIT_TAKEN", symbol, {
            partialQty,
            remainingQty: qty - partialQty,
            price: currentPrice,
            profitPercent: unrealizedPercent,
            dropFromHigh,
            smartExitDecision,
            partialOrder,
          });
          saveEngineState("SMART_PARTIAL_PROFIT_TAKEN");
          continue;
        } catch (err) {
          recordFailedOrder("SMART_PARTIAL_PROFIT_FAILED", symbol, err.message, {
            qty,
            price: currentPrice,
            profitPercent: unrealizedPercent,
            dropFromHigh,
            smartExitDecision,
          });
        }
      }
      if (
        !shouldStopLoss &&
        !shouldProtectProfit &&
        !shouldNormalTrailingExit &&
        !shouldRunnerTrailingExit &&
        !continuationHoldExitDecision.shouldExit &&
        !smartExitDecision.shouldForceExit &&
        !institutionalExitDecision.shouldForceExit &&
        !distributionClimaxDecision.shouldExitClimax &&
        !adaptiveOvernightHoldDecision.shouldExitBeforeClose &&
        !smartSwingConversionDecision.shouldProtectSwing &&
        !exitParliamentDecision.shouldConsensusExit
      ) {
        continue;
      }
      let reason = "AI_EXIT";
      if (shouldStopLoss) reason = "STOP_LOSS";
      else if (exitParliamentDecision.emergencyExit) reason = "EXIT_PARLIAMENT_EMERGENCY_EXIT";
      else if (exitParliamentDecision.shouldConsensusExit) reason = "EXIT_PARLIAMENT_CONSENSUS_EXIT";
      else if (smartExitDecision.continuationFailure) reason = "CONTINUATION_FAILURE_EXIT";
      else if (smartExitDecision.runnerFailure) reason = "RUNNER_FAILURE_EXIT";
      else if (smartExitDecision.shouldForceExit) reason = "SMART_FORCE_EXIT";
      else if (institutionalExitDecision.shouldForceExit) reason = "INSTITUTIONAL_FORCE_EXIT";
      else if (distributionClimaxDecision.shouldExitClimax) reason = "CLIMAX_DISTRIBUTION_EXIT";
      else if (adaptiveOvernightHoldDecision.shouldExitBeforeClose) reason = "OVERNIGHT_RISK_EXIT";
      else if (continuationHoldExitDecision.shouldExit) reason = "NON_SELECTED_CONTINUATION_EXIT";
      else if (shouldRunnerTrailingExit) reason = "RUNNER_TRAILING_STOP";
      else if (shouldProtectProfit) reason = "PROFIT_PROTECTION";
      else if (shouldNormalTrailingExit) reason = "TRAILING_STOP";
      const exitLearningAdjustment =
        getExitReinforcementAdjustment(reason, "stock");
      const runnerExitDelayGate =
        calculateRunnerExitDelayGate({
          symbol,
          reason,
          isRunner,
          unrealizedPercent,
          dropFromHigh,
          trendQualityHold,
          trendHoldDecision,
          exitLearningAdjustment,
        });
      if (runnerExitDelayGate.shouldDelayExit) {
        recordOrder("RUNNER_EXIT_DELAYED_BY_LEARNING", symbol, {
          reason,
          qty,
          price: currentPrice,
          profitPercent: unrealizedPercent,
          dropFromHigh,
          exitLearningAdjustment,
          runnerExitDelayGate,
        });
        updateExitDashboardState({
          symbol,
          action: "RUNNER_EXIT_DELAYED",
          reason,
          profitPercent: unrealizedPercent,
          runnerExitDelayGate,
          exitLearningAdjustment,
        });
        continue;
      }
      const weakSetupFastExitGate =
        calculateWeakSetupFastExitGate({
          symbol,
          unrealizedPercent,
          dropFromHigh,
          isRunner,
        });
      if (weakSetupFastExitGate.shouldFastExit) {
        reason = "WEAK_SETUP_FAST_EXIT";
      }
      const overnightHoldRiskGate =
        calculateOvernightHoldRiskGate({
          symbol,
          unrealizedPercent,
          isRunner,
        });
      if (
        overnightHoldRiskGate.shouldProtectBeforeClose &&
        reason === "AI_EXIT"
      ) {
        reason = "OVERNIGHT_PROTECTION_EXIT";
      }
      const smartTrimDecision =
        calculateSmartTrimDecision({
          symbol,
          qty,
          unrealizedPercent,
          dropFromHigh,
          isRunner,
        });
      if (
        smartTrimDecision.shouldTrim &&
        !shouldStopLoss &&
        !exitParliamentDecision.emergencyExit
      ) {
        try {
          const trimOrder = await placeMarketSell(
            symbol,
            smartTrimDecision.trimQty,
            "SMART_RUNNER_TRIM"
          );
          recordOrder("SMART_RUNNER_TRIM_EXECUTED", symbol, {
            trimQty: smartTrimDecision.trimQty,
            originalQty: qty,
            price: currentPrice,
            profitPercent: unrealizedPercent,
            dropFromHigh,
            smartTrimDecision,
            trimOrder,
          });
          updateExitDashboardState({
            symbol,
            action: "SMART_RUNNER_TRIM",
            profitPercent: unrealizedPercent,
            smartTrimDecision,
          });
          saveEngineState("SMART_RUNNER_TRIM_EXECUTED");
          continue;
        } catch (err) {
          recordFailedOrder("SMART_RUNNER_TRIM_FAILED", symbol, err.message, {
            smartTrimDecision,
            qty,
            price: currentPrice,
            profitPercent: unrealizedPercent,
          });
        }
      }
      updateExitDashboardState({
        symbol,
        action: "FULL_EXIT_REVIEWED",
        reason,
        profitPercent: unrealizedPercent,
        dropFromHigh,
        isRunner,
        exitLearningAdjustment,
        weakSetupFastExitGate,
        overnightHoldRiskGate,
      });
      const pdtFullExitProtection =
        calculatePdtExitProtection({
          symbol,
          account: engineState.cachedAccount || {},
          reason,
          qty,
          exitType: "FULL_EXIT",
          shouldStopLoss,
          exitParliamentDecision,
        });
      if (pdtFullExitProtection.shouldDeferExit) {
        addPendingExit(symbol, qty, "PDT_DEFERRED_EXIT", {
          price: currentPrice,
          highWater,
          dropFromHigh,
          profitPercent: unrealizedPercent,
          originalReason: reason,
          pdtFullExitProtection,
        });
        recordOrder("PDT_EXIT_DEFERRED", symbol, {
          qty,
          price: currentPrice,
          profitPercent: unrealizedPercent,
          originalReason: reason,
          pdtFullExitProtection,
        });
        saveEngineState("PDT_EXIT_DEFERRED");
        continue;
      }
      if (!marketOpen) {
        addPendingExit(symbol, qty, reason, {
          price: currentPrice,
          highWater,
          dropFromHigh,
          profitPercent: unrealizedPercent,
          isRunner,
        });
        recordOrder("EXIT_PENDING_MARKET_CLOSED", symbol, {
          dynamicRunnerTrailingStopPercent,
          trendHoldMode: trendHoldDecision.mode,
          trendHoldReason: trendHoldDecision.reason,
          qty,
          price: currentPrice,
          highWater,
          dropFromHigh,
          profitPercent: unrealizedPercent,
          reason,
          isRunner,
        });
        continue;
      }
      try {
        const order = await placeMarketSell(symbol, qty, reason);
        if (
          unrealizedPercent >=
          Number(CONFIG.runnerTriggerPercent || 6)
        ) {
          if (!engineState.statisticalMemoryState) {
            engineState.statisticalMemoryState = {
              updatedAt: new Date().toISOString(),
              setupHistory: [],
              setupPerformance: {},
              expectancyHistory: [],
              probabilityHistory: [],
            };
          }
          const reinforcementSetupType =
            engineState.aiEntryScores?.[symbol]
              ?.setupType || "UNKNOWN_SETUP";
          engineState.statisticalMemoryState.setupHistory.unshift({
            symbol,
            setupType: reinforcementSetupType,
            timestamp: new Date().toISOString(),
            profitPercent: Number(
              unrealizedPercent.toFixed(2)
            ),
            reinforcementSource: "LIVE_RUNNER_EXIT",
          });
          engineState.statisticalMemoryState.setupHistory =
            engineState.statisticalMemoryState.setupHistory.slice(
              0,
              500
            );
        }
        if (
          unrealizedPercent <=
          -Number(CONFIG.stopLossPercent || 1)
        ) {
          if (!engineState.statisticalMemoryState) {
            engineState.statisticalMemoryState = {
              updatedAt: new Date().toISOString(),
              setupHistory: [],
              setupPerformance: {},
              expectancyHistory: [],
              probabilityHistory: [],
            };
          }
          const weakeningSetupType =
            engineState.aiEntryScores?.[symbol]
              ?.setupType || "UNKNOWN_SETUP";
          engineState.statisticalMemoryState.setupHistory.unshift({
            symbol,
            setupType: weakeningSetupType,
            timestamp: new Date().toISOString(),
            profitPercent: Number(
              unrealizedPercent.toFixed(2)
            ),
            reinforcementSource: "LIVE_STOP_LOSS",
          });
          engineState.statisticalMemoryState.setupHistory =
            engineState.statisticalMemoryState.setupHistory.slice(
              0,
              500
            );
        }
        recordOrder(reason, symbol, {
          dynamicRunnerTrailingStopPercent,
          trendHoldMode: trendHoldDecision.mode,
          trendHoldReason: trendHoldDecision.reason,
          qty,
          price: currentPrice,
          highWater,
          dropFromHigh,
          profitPercent: unrealizedPercent,
          smartExitDecision,
          institutionalExitDecision,
          distributionClimaxDecision,
          institutionalReloadDecision,
          adaptiveOvernightHoldDecision,
          smartSwingConversionDecision,
          exitParliamentDecision,
          isRunner,
          order,
        });
        const reloadReentryMemory =
          updateReloadReentryMemory({
            symbol,
            reason,
            unrealizedPercent,
            isRunner,
          });
        updateExitDashboardState({
          symbol,
          action: "FULL_EXIT_EXECUTED",
          reason,
          profitPercent: unrealizedPercent,
          isRunner,
          reloadReentryMemory,
        });
        saveEngineState("PROBABILITY_REINFORCEMENT_UPDATED");
        rememberTradeResult(symbol, {
          profitPercent: unrealizedPercent,
          reason,
        });
        saveEngineState("CRYPTO_PROBABILITY_REINFORCEMENT_UPDATED");
        journalTradeExit(symbol, {
          assetClass: "stock",
          exitType: "AUTO_STOCK_EXIT",
          exitPrice: currentPrice,
          profitPercent: unrealizedPercent,
          exitReason: reason,
        });
        delete engineState.highWaterMarks[symbol];
        engineState.lastSoldAt[symbol] = Date.now();
        delete engineState.aiEntryScores[symbol];
        delete engineState.runnerPositions[symbol];
      } catch (err) {
        recordFailedOrder(`${reason}_FAILED`, symbol, err.message, {
          dynamicRunnerTrailingStopPercent,
          trendHoldMode: trendHoldDecision.mode,
          trendHoldReason: trendHoldDecision.reason,
          qty,
          price: currentPrice,
          highWater,
          dropFromHigh,
          profitPercent: unrealizedPercent,
          isRunner,
        });
      }
    }
  }
  
  async function autoExitCryptoPositions() {
    const TRADING_MODE = getTradingMode();
    if (!["live_crypto", "live_stock", "smart"].includes(TRADING_MODE)) return;
    const positions = await getPositions();
    const aiOwnedSymbols = await getBotOwnedSymbols();
    for (const pos of positions) {
      const symbol = normalizeSymbol(pos.symbol);
      if (!symbol.endsWith("USD")) continue;
      if (!isAiManagedOpenPosition(pos, aiOwnedSymbols)) continue;
      const qty = Number(pos.qty);
      const currentPrice = Number(pos.current_price);
      const profitPercent = Number(pos.unrealized_plpc) * 100;
      if (!qty || qty <= 0 || !currentPrice) continue;
      const previousHigh = Number(engineState.highWaterMarks[symbol] || 0);
      const highWater = Math.max(previousHigh, currentPrice);
      engineState.highWaterMarks[symbol] = highWater;
      const dropFromHigh =
        highWater > 0 ? ((highWater - currentPrice) / highWater) * 100 : 0;
      const adaptiveSwingRisk = calculateSwingRisk(
        {
          symbol,
          current: currentPrice,
          price: currentPrice,
          high: highWater,
          low: Number(pos.avg_entry_price || currentPrice),
          score: engineState.aiEntryScores?.[symbol]?.score || 0,
          technicalScore:
            engineState.aiEntryScores?.[symbol]?.technicalScore || 0,
          statisticalScore:
            engineState.aiEntryScores?.[symbol]?.statisticalScore || 0,
          trendPersistenceScore:
            engineState.trendPersistenceState?.heldSymbols?.[symbol]
              ?.trendPersistenceScore || 0,
          percentChange: profitPercent,
          assetType: "crypto",
        },
        { assetType: "crypto" }
      );
      const trendQualityHold =
        calculateTrendQualityHoldDuration({
          symbol,
          score: engineState.aiEntryScores?.[symbol]?.score || 0,
          technicalScore:
            engineState.aiEntryScores?.[symbol]?.technicalScore || 0,
          statisticalScore:
            engineState.aiEntryScores?.[symbol]?.statisticalScore || 0,
          trendPersistenceScore:
            engineState.trendPersistenceState?.heldSymbols?.[symbol]
              ?.trendPersistenceScore || 0,
          unrealizedPercent: profitPercent,
          dropFromHigh,
        });
      const trailingActive =
        profitPercent >= adaptiveSwingRisk.takeProfitPercent * 0.5;
      const shouldStopLoss =
        profitPercent <= adaptiveSwingRisk.stopLossPercent;
      const shouldTrailingStop =
        trailingActive &&
        profitPercent >= 1.5 &&
        dropFromHigh >=
        Math.abs(adaptiveSwingRisk.trailingStopPercent);
      if (
        trendQualityHold.shouldExtendHold &&
        !shouldStopLoss
      ) {
        recordOrder("CRYPTO_TREND_QUALITY_HOLD", symbol, {
          qty,
          currentPrice,
          profitPercent,
          highWater,
          dropFromHigh,
          trendQualityHold,
          adaptiveSwingRisk,
        });
        continue;
      }
      if (!shouldStopLoss && !shouldTrailingStop) continue;
      let reason = "CRYPTO_EXIT";
      if (shouldStopLoss) reason = "CRYPTO_STOP_LOSS";
      else if (shouldTrailingStop) reason = "CRYPTO_TRAILING_STOP";
      try {
        const order = await placeCryptoMarketSell(symbol, qty, reason);
        recordOrder("AUTO_CRYPTO_SELL", symbol, {
          qty,
          currentPrice,
          profitPercent,
          highWater,
          dropFromHigh,
          reason,
          order,
        });
        journalTradeExit(symbol, {
          assetClass: "crypto",
          exitType: "AUTO_CRYPTO_EXIT",
          exitPrice: currentPrice,
          profitPercent,
          exitReason: reason,
        });
        rememberTradeResult(symbol, {
          profitPercent,
          reason,
        });
        delete engineState.highWaterMarks[symbol];
        engineState.lastSoldAt[symbol] = Date.now();
      } catch (err) {
        recordFailedOrder("AUTO_CRYPTO_SELL_FAILED", symbol, err.message, {
          qty,
          currentPrice,
          profitPercent,
          reason,
        });
      }
    }
  }

  return { autoExitPositions, autoExitCryptoPositions };
}
