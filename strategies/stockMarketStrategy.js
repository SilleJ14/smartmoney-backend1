import {
  buildDecisionScoreTelemetry,
  calculateEarlyDiscoveryScore,
  calculateEntryQualityScore,
  calculateMultiDayContinuationScore,
} from "../scoring/decisionScores.js";

export function createStockMarketStrategy(dependencies) {
  const {
    CONFIG,
    activeScanLocks,
    applyAutonomousCapitalRotation,
    applyFastRunnerOverride,
    applyInstitutionalArchitecture,
    applySmallCapRunnerExecutionRelaxation,
    applyThemeMomentumBoost,
    broadcastTapeEvent,
    calculateAccumulationEngine,
    calculateAdaptiveRunnerLearning,
    calculateAiPortfolioManagerDecision,
    calculateCatalystRankingEngine,
    calculateDcfValuation,
    calculateDividendCompoundingScore,
    calculateDividendWealthEngine,
    calculateEarlyStrengthProjection,
    calculateEarningsScore,
    calculateExplosiveRunnerPrediction,
    calculateExplosiveRunnerScore700,
    calculateInstitutionalBlend,
    calculateInstitutionalExecutionPlan,
    calculateInstitutionalGrade,
    calculateMoatEngine,
    calculateMultiDayProbability,
    calculatePhase10RunnerFingerprint,
    calculatePhase11MetaStrategyMutation,
    calculatePhase12MacroCorrelationSignal,
    calculatePhase13HedgeFundBrain,
    calculatePhase14ProfitAccelerationGovernor,
    calculatePhase15AutonomousExecutionDominance,
    calculatePhase7ReinforcementLearning,
    calculatePhase9LiquidityIntelligence,
    calculatePortfolioScore,
    calculatePremarketDominanceEngine,
    calculatePremarketMomentumEngine,
    calculateRiskScore,
    calculateRunnerHoldQuality,
    calculateRunnerStageProfile,
    calculateScoringLayers,
    calculateSignalQuality,
    calculateStatisticalEdge,
    calculateStatisticalEdgeEngine,
    calculateTechnicalIntelligence,
    calculateThemeMomentumEngine,
    calculateVolatilityCompressionEngine,
    checkAssetEligibility,
    clampScore,
    clampScoreFinal,
    computeTechnicals,
    detectMarketRegime,
    engineState,
    estimateSectorIntelligence,
    evaluateInstitutionalApproval,
    executePyramidScalingAdds,
    getAccount,
    getAdvancedConfirmations,
    getBotOwnedSymbols,
    getPositions,
    getRiskLevel,
    getStockIdentity,
    getStockQuote,
    getSuggestedHoldTime,
    getTopMovers,
    getTradeQuality,
    isMorningStrikeWindow,
    isPremarketMomentumWindow,
    narrowScanUniverse,
    normalizeSymbol,
    processBatches,
    recordFailedOrder,
    recordOrder,
    recordSkippedSymbol,
    updateAdaptiveRunnerLearningState,
    updateAutonomousCapitalRotationState,
    updateAutonomousMarketIntelligenceState,
    updateContinuationHoldState,
    updateExplosiveRunnerState,
    updateFullInstitutionalAiBrainState,
    updateInstitutionalExecutionLayerState,
    updateMultiDayAccumulationState,
    updatePhase10RunnerMemoryState,
    updatePhase11MetaStrategyState,
    updatePhase12MacroCorrelationState,
    updatePhase13HedgeFundBrainState,
    updatePhase14GovernorState,
    updatePhase15ExecutionDominanceState,
    updatePhase7ReinforcementLearningState,
    updatePhase9LiquidityIntelligenceState,
    updatePremarketDominanceState,
    updatePremarketMomentumState,
    updateSwingWatchlistState,
    getTradingMode,
  } = dependencies;

  function calculateInstitutionalScores(q) {
    const TRADING_MODE = getTradingMode();
    const confirmations = q.confirmations || {};
    const technicals = q.technicals || {};
    const momentum = Number(q.percentChange || 0);
    const volumeRatio = Number(confirmations.volumeSpikeRatio || q.volumeRatio || 0);
    const premarketContinuationRelief =
      !engineState.marketOpen &&
      (
        isPremarketMomentumWindow() ||
        isMorningStrikeWindow()
      ) &&
      Number(
        q.premarketContinuationScore ||
        q.premarketDominanceScore ||
        q.openingDriveProbability ||
        q.continuationProbability ||
        q.breakoutProbability ||
        0
      ) >= 70;
    const rsi = Number(technicals.rsi || 50);
    const ema9 = Number(technicals.ema9 || 0);
    const ema20 = Number(technicals.ema20 || 0);
    const macd = Number(technicals.macd || 0);
    const macdSignal = Number(technicals.macdSignal || 0);
    const institutionalDcf =
      calculateDcfValuation(q);
    const earnings = calculateEarningsScore(q);
    const edge = calculateStatisticalEdge(q);
    const citadelTechnical = calculateTechnicalIntelligence(q);
    const moat = calculateMoatEngine(q);
    const wealth = calculateDividendWealthEngine(q);
    const harvardDividend =
      calculateDividendCompoundingScore(q);
    const portfolio = calculatePortfolioScore(q);
    const sector = estimateSectorIntelligence(q);
    const advancedRisk = calculateRiskScore(q);
    const technicalScore = citadelTechnical.technicalScore;
    const riskScore = clampScore(
      80 -
      (confirmations.fakeBreakout ? (premarketContinuationRelief ? 10 : 35) : 0) -
      (confirmations.gapTooHigh ? (premarketContinuationRelief ? 6 : 20) : 0) -
      (confirmations.newsRisk ? 30 : 0) -
      (momentum > 25 ? (premarketContinuationRelief ? 5 : 15) : 0) -
      (volumeRatio < 0.8 ? 10 : 0)
    );
    const blendedRiskScore = clampScore(
      riskScore * 0.55 +
      advancedRisk.institutionalRiskScore * 0.45
    );
    const statisticalScore = edge.statisticalEdgeScore;
    const regime = engineState.marketRegime || detectMarketRegime([]);
    const macroScore = clampScore(
      regime.state === "aggressive bullish"
        ? 85
        : regime.state === "cautious bullish"
          ? 70
          : regime.state === "defensive"
            ? 50
            : 25
    );
    const fundamentalScore = institutionalDcf.fundamentalScore;
    const fundamentalDataValid = institutionalDcf.fundamentalDataValid === true;
    const dcfValuationScore = institutionalDcf.dcfValuationScore;
    const earningsScore = earnings.earningsScore;
    const moatScore = moat.moatScore;
    const dividendScore = wealth.wealthBuilderScore;
    const harvardDividendScore =
      harvardDividend.harvardDividendCompoundingScore;
    const portfolioScore = portfolio.portfolioScore;
    const reinforcementWeights =
      engineState.reinforcementWeightState?.weights;
    const blend = calculateInstitutionalBlend({
      reinforcementWeights,
      momentum,
      volumeRatio,
      premarketContinuationRelief,
      technicalScore,
      fundamentalScore,
      fundamentalDataValid,
      dcfValuationScore,
      earningsScore,
      moatScore,
      dividendScore,
      harvardDividendScore,
      macroScore,
      statisticalScore,
      blendedRiskScore,
      portfolioScore,
      sectorScore: sector.sectorScore,
    }, { clampScore });
    const {
      momentumScore,
      fundamentalBlendScore,
      institutionalScore,
    } = blend;
    const approval = evaluateInstitutionalApproval({
      fakeBreakout: confirmations.fakeBreakout === true,
      newsRisk: confirmations.newsRisk === true,
      blendedRiskScore,
      exhaustionRiskScore: citadelTechnical.exhaustionRiskScore,
      volume: q.volume,
      percentChange: q.percentChange,
      maxPercentChange: CONFIG.maxPercentChange,
      institutionalScore,
      minScoreToBuy: CONFIG.minScoreToBuy,
      institutionalEntryScore: Number(q.entryQualityScore || citadelTechnical.institutionalEntryScore || 0),
      tradingMode: TRADING_MODE,
      fundamentalDataValid,
      valuationRiskScore: institutionalDcf.valuationRiskScore,
      earningsRiskMode: earnings.earningsRiskMode,
      earningsVolatilityRiskScore: earnings.earningsVolatilityRiskScore,
      competitiveAdvantageScore: moat.competitiveAdvantageScore,
    });
    const { hardSafetyPass, institutionalQualityPass, stockResearchPass,
      autoTradeApproved, decisionLevel } = approval;
    return {
      technicalScore,
      momentumScore,
      fundamentalBlendScore,
      reinforcementWeights: blend.reinforcementWeights,
      technicalIntelligence: citadelTechnical,
      trendQualityScore: citadelTechnical.trendQualityScore,
      breakoutQualityScore: citadelTechnical.breakoutQualityScore,
      executionTimingScore: citadelTechnical.executionTimingScore,
      exhaustionRiskScore: citadelTechnical.exhaustionRiskScore,
      institutionalEntryGrade: citadelTechnical.institutionalEntryGrade,
      macroScore,
      riskScore: blendedRiskScore,
      legacyRiskScore: riskScore,
      institutionalRiskScore: advancedRisk.institutionalRiskScore,
      drawdownRiskScore: advancedRisk.drawdownRiskScore,
      volatilityShockScore: advancedRisk.volatilityShockScore,
      liquidityStressScore: advancedRisk.liquidityStressScore,
      downsideExposureScore: advancedRisk.downsideExposureScore,
      crashSurvivabilityScore: advancedRisk.crashSurvivabilityScore,
      institutionalRiskLabel: advancedRisk.institutionalRiskLabel,
      statisticalScore,
      ...edge,
      fundamentalScore,
      fundamentalDataValid,
      fundamentalValidation: institutionalDcf.fundamentalValidation,
      institutionalScoreTelemetry: blend.componentTelemetry,
      dcfValuation: institutionalDcf,
      dcfValuationScore,
      valuationRiskScore:
        institutionalDcf.valuationRiskScore,
      marginOfSafetyScore:
        institutionalDcf.marginOfSafetyScore,
      qualityAdjustedMarginOfSafety:
        institutionalDcf.qualityAdjustedMarginOfSafety,
      valuationLabel:
        institutionalDcf.valuationLabel,
      valuationAction:
        institutionalDcf.valuationAction,
      intrinsicValue:
        institutionalDcf.baseDcf?.intrinsicValue || 0,
      valuationGapPercent:
        institutionalDcf.baseDcf?.valuationGapPercent || 0,
      valuationScore:
        institutionalDcf.dcfValuationScore || dcfValuationScore,
      balanceSheetHealthScore:
        institutionalDcf.baseDcf?.balanceSheetHealthScore || 50,
      cashFlowScore:
        institutionalDcf.baseDcf?.cashFlowScore || 50,
      revenueGrowthScore:
        institutionalDcf.baseDcf?.revenueGrowthScore || 50,
      marginScore:
        institutionalDcf.baseDcf?.marginScore || 50,
      debtRiskScore:
        institutionalDcf.baseDcf?.debtRiskScore || 50,
      earningsScore,
      earningsIntelligence: earnings,
      earningsRiskMode: earnings.earningsRiskMode,
      earningsAction: earnings.earningsAction,
      earningsVolatilityRiskScore:
        earnings.earningsVolatilityRiskScore,
      revenueQualityScore: earnings.revenueQualityScore,
      guidanceScore: earnings.guidanceScore,
      marginExpansionScore: earnings.marginExpansionScore,
      epsSurpriseQualityScore: earnings.epsSurpriseQualityScore,
      institutionalEarningsSentiment: earnings.institutionalEarningsSentiment,
      earningsCashFlowStrength: earnings.earningsCashFlowStrength,
      moatScore,
      competitiveAdvantageScore: moat.competitiveAdvantageScore,
      brandStrengthScore: moat.brandStrengthScore,
      pricingPowerScore: moat.pricingPowerScore,
      marketPositionScore: moat.marketPositionScore,
      durabilityScore: moat.durabilityScore,
      reinvestmentQualityScore: moat.reinvestmentQualityScore,
      moatLabel: moat.moatLabel,
      dividendScore,
      dividendSafetyScore: wealth.dividendSafetyScore,
      dividendGrowthScore: wealth.dividendGrowthScore,
      shareholderYieldScore: wealth.shareholderYieldScore,
      compoundingPotentialScore: wealth.compoundingPotentialScore,
      incomeStabilityScore: wealth.incomeStabilityScore,
      wealthBuilderScore: wealth.wealthBuilderScore,
      wealthProfile: wealth.wealthProfile,
      harvardDividendCompounding: harvardDividend,
      harvardDividendScore,
      harvardStabilityScore:
        harvardDividend.harvardStabilityScore,
      endowmentQualityScore:
        harvardDividend.endowmentQualityScore,
      capitalPreservationScore:
        harvardDividend.capitalPreservationScore,
      harvardDividendProfile:
        harvardDividend.harvardDividendProfile,
      portfolioScore,
      portfolioConstructionScore: portfolio.portfolioConstructionScore,
      liquidityFitScore: portfolio.liquidityFitScore,
      volatilityBalanceScore: portfolio.volatilityBalanceScore,
      diversificationFitScore: portfolio.diversificationFitScore,
      positionSizingQualityScore: portfolio.positionSizingQualityScore,
      portfolioRiskContributionScore: portfolio.portfolioRiskContributionScore,
      portfolioRole: portfolio.portfolioRole,
      suggestedAllocationTier: portfolio.suggestedAllocationTier,
      estimatedSector: sector.estimatedSector,
      sectorScore: sector.sectorScore,
      sectorMomentumScore: sector.sectorMomentumScore,
      sectorRiskScore: sector.sectorRiskScore,
      sectorLiquidityScore: sector.sectorLiquidityScore,
      sectorLeadershipScore: sector.sectorLeadershipScore,
      sectorRole: sector.sectorRole,
      institutionalScore,
      aiConfidence: institutionalScore,
      riskLevel: getRiskLevel(riskScore),
      tradeQuality: getTradeQuality(institutionalScore),
      marketRegime: regime.label || "Unknown",
      suggestedHoldTime: getSuggestedHoldTime(institutionalScore),
      decisionLevel,
      autoTradeApproved,
    };
  }
  
  function passesFilters(q) {
    const price = Number(q.current || q.price || 0);
    const volume = Number(q.volume || q.barVolume || 0);
    const relativeVolume = Number(
      q.relativeVolume ||
      q.volumeRatio ||
      q.volumeSpikeRatio ||
      q.confirmations?.volumeSpikeRatio ||
      0
    );
    const floatShares = Number(
      q.floatShares ||
      q.freeFloat ||
      q.shareFloat ||
      q.sharesFloat ||
      0
    );
    const marketCap = Number(
      q.marketCap ||
      q.marketCapitalization ||
      0
    );
    const percentChange = Number(q.percentChange || 0);
    const spreadPercent = Number(
      q.spreadPercent ||
      q.liveSpreadPercent ||
      q.confirmations?.spreadPercent ||
      0
    );
    const pullbackFromHighPercent = Number(
      q.confirmations?.pullbackFromHighPercent ||
      q.pullbackFromHighPercent ||
      0
    );
  
    const hasNews =
      q.hasNews === true ||
      Number(q.newsScore || 0) > 0 ||
      Number(q.catalystScore || 0) > 0 ||
      Number(q.catalystRanking?.catalystScore || 0) > 0 ||
      (Array.isArray(q.news) && q.news.length > 0);
  
    const hasMomentum =
      percentChange > 0 ||
      Number(q.momentumScore || 0) >= 60 ||
      Number(q.breakoutScore || 0) >= 60 ||
      q.runnerStage === "IGNITION" ||
      q.runnerStage === "EXPANSION" ||
      q.confirmations?.volumeSpike === true;
  
    const preMoverScore = Number(
      q.preMoveScore ||
      engineState.preMoverDiscoveryMemory?.[normalizeSymbol(q.symbol || "")]?.preMoveScore ||
      0
    );
  
    const premarketContinuationScore = Math.max(
      Number(q.premarketContinuationScore || 0),
      Number(q.premarketDominanceScore || 0),
      Number(q.morningMomentumScore || 0),
      Number(q.openingDriveProbability || 0),
      Number(q.continuationProbability || 0),
      Number(q.breakoutProbability || 0)
    );
  
    const premarketContinuationWindow =
      !engineState.marketOpen &&
      (
        isPremarketMomentumWindow() ||
        isMorningStrikeWindow()
      );
  
    const strongPremarketContinuation =
      premarketContinuationWindow &&
      premarketContinuationScore >= 70;
  
    const explosiveRunnerRescue =
      percentChange >= 40 &&
      percentChange <= Number(CONFIG.maxPercentChange || 300) &&
      (
        relativeVolume >= 2 ||
        volume >= Number(CONFIG.minScanVolume || 300000) * 2 ||
        q.confirmations?.volumeSpike === true ||
        q.explosiveMoveCandidate === true ||
        q.parabolicRunnerCandidate === true
      );
  
    const discoveryRescue =
      explosiveRunnerRescue ||
      strongPremarketContinuation ||
      preMoverScore >= 75;
  
    const allowRiskDisplay =
      explosiveRunnerRescue ||
      strongPremarketContinuation;
  
    function discoveryOnly(reason, extra = {}) {
      q.discoveryOnly = true;
      q.buyBlocked = true;
      q.blockBuying = true;
      q.displayOnly = true;
      q.buyBlockReason = reason;
      q.displayOnlyReason = reason;
  
      return {
        ok: true,
        discoveryOnly: true,
        buyBlocked: true,
        blockBuying: true,
        displayOnly: true,
        reason,
        ...extra,
      };
    }
  
    if (!price || price <= 0) {
      return { ok: false, reason: "No valid price" };
    }
  
    if (price < CONFIG.minStockPrice) {
      return { ok: false, reason: `Price below $${CONFIG.minStockPrice}` };
    }
  
    if (CONFIG.maxStockPrice > 0 && price > CONFIG.maxStockPrice) {
      return { ok: false, reason: `Price above max: $${price}` };
    }
  
    if (volume < CONFIG.minScanVolume && !discoveryRescue) {
      return { ok: false, reason: `Volume below ${CONFIG.minScanVolume}` };
    }
  
    if (volume < CONFIG.minScanVolume && discoveryRescue) {
      return discoveryOnly(
        `Discovery only: volume below ${CONFIG.minScanVolume}, but runner/continuation rescue passed`
      );
    }
  
    if (
      relativeVolume < Number(CONFIG.minRunnerRelativeVolume || 5) &&
      !discoveryRescue
    ) {
      return {
        ok: false,
        reason: `RVOL below ${CONFIG.minRunnerRelativeVolume || 5}x`,
      };
    }
  
    if (floatShares > 0 && floatShares > Number(CONFIG.maxRunnerFloatShares || 20000000)) {
      if (allowRiskDisplay) {
        return discoveryOnly(`Discovery only: float too high ${floatShares}`);
      }
  
      return { ok: false, reason: `Float too high: ${floatShares}` };
    }
  
    if (marketCap > 0 && marketCap > Number(CONFIG.maxRunnerMarketCap || 1000000000)) {
      if (allowRiskDisplay) {
        return discoveryOnly(`Discovery only: market cap too high ${marketCap}`);
      }
  
      return { ok: false, reason: `Market cap too high: ${marketCap}` };
    }
  
    if (!hasNews && !hasMomentum && !discoveryRescue) {
      return { ok: false, reason: "No news or strong momentum" };
    }
  
    if (percentChange > CONFIG.maxPercentChange) {
      return discoveryOnly(
        `Dangerously extended: ${percentChange.toFixed(2)}%`
      );
    }
  
    if (spreadPercent > Number(CONFIG.maxRunnerSpreadPercent || 3)) {
      if (allowRiskDisplay) {
        return discoveryOnly(
          `Spread too wide: ${spreadPercent.toFixed(2)}%`
        );
      }
  
      return {
        ok: false,
        reason: `Spread too wide: ${spreadPercent.toFixed(2)}%`,
      };
    }
  
    if (pullbackFromHighPercent >= Number(CONFIG.maxRunnerPullbackFromHighPercent || 18)) {
      if (allowRiskDisplay || strongPremarketContinuation) {
        return discoveryOnly(
          `Too far from high: ${pullbackFromHighPercent.toFixed(2)}%`
        );
      }
  
      return {
        ok: false,
        reason: `Too far from high: ${pullbackFromHighPercent.toFixed(2)}%`,
      };
    }
  
    if (CONFIG.enableAdvancedFilters && q.confirmations) {
      if (q.confirmations.fakeBreakout) {
        if (allowRiskDisplay || strongPremarketContinuation) {
          return discoveryOnly(
            `Fake breakout risk. Pulled back ${pullbackFromHighPercent}% from high`
          );
        }
  
        return {
          ok: false,
          reason: `Fake breakout risk. Pulled back ${pullbackFromHighPercent}% from high`,
        };
      }
  
      if (q.confirmations.newsRisk) {
        if (allowRiskDisplay) {
          return discoveryOnly(
            `News risk: ${q.confirmations.newsRiskReason}`
          );
        }
  
        return {
          ok: false,
          reason: `News risk: ${q.confirmations.newsRiskReason}`,
        };
      }
    }
  
    return {
      ok: true,
      discoveryOnly: false,
      buyBlocked: false,
      blockBuying: false,
      displayOnly: false,
    };
  }
  
  function scoreStock(q) {
    let score = 0;
    const runnerStageProfile = calculateRunnerStageProfile(q);
    q.runnerStage = runnerStageProfile.runnerStage;
    q.runnerStageProfile = runnerStageProfile;
    q.lateChaseRisk = runnerStageProfile.lateChaseRisk;
    const runnerHoldQuality = calculateRunnerHoldQuality(q);
    q.runnerHoldQuality = runnerHoldQuality;
    q.runnerHoldScore = runnerHoldQuality.runnerHoldScore;
    if (
      q.current >= CONFIG.minStockPrice &&
      (CONFIG.maxStockPrice <= 0 || q.current <= CONFIG.maxStockPrice)
    ) {
      score += 18;
    }
    if (q.percentChange > 40 && q.percentChange <= CONFIG.maxPercentChange) {
      score += 18;
      q.explosiveMoveCandidate = true;
      q.parabolicRunnerCandidate = true;
    } else if (q.percentChange >= 15 && q.percentChange <= 40) {
      score += 28;
      q.explosiveMoveCandidate = true;
    } else if (q.percentChange >= 5 && q.percentChange < 15) {
      score += 22;
    } else if (q.percentChange >= 2 && q.percentChange < 5) {
      score += 15;
    } else if (q.percentChange >= 1 && q.percentChange < 2) {
      score += 8;
    } else if (q.percentChange > 0) {
      score += 4;
    }
    if (q.open > 0 && q.current > q.open) score += 15;
    if (q.previousClose > 0 && q.current > q.previousClose) score += 15;
    if (q.high > q.low && q.current > 0) {
      const closeNearHigh = ((q.current - q.low) / (q.high - q.low)) * 100;
      if (closeNearHigh >= 85) score += 10;
      else if (closeNearHigh >= 70) score += 6;
    }
    if (q.volume >= CONFIG.minVolume) score += 10;
    if (q.runnerStage === "IGNITION") {
      score += 18;
    } else if (q.runnerStage === "EXPANSION") {
      score += 10;
    } else if (q.runnerStage === "MATURE") {
      score -= 6;
    } else if (q.runnerStage === "EXHAUSTION") {
      score -= 35;
    } else if (q.runnerStage === "WATCHING") {
      score -= 5; // Fixed: soft penalty for stagnant setups
    }
    const earlyTechnicalProfile =
      q.confirmations?.earlyTechnicalProfile ||
      q.earlyTechnicalProfile ||
      null;
    if (earlyTechnicalProfile) {
      q.earlyTechnicalProfile = earlyTechnicalProfile;
      q.earlyTechnicalScore = Number(earlyTechnicalProfile.earlyTechnicalScore || 0);
      q.earlyTechnicalGrade = earlyTechnicalProfile.earlyTechnicalGrade;
      let earlyTechnicalBoost = 0;
      if (q.runnerStage === "IGNITION") {
        earlyTechnicalBoost = q.earlyTechnicalScore * 0.25;
      } else if (q.runnerStage === "EXPANSION") {
        earlyTechnicalBoost = q.earlyTechnicalScore * 0.2;
      } else if (q.runnerStage === "WATCHING") {
        earlyTechnicalBoost = q.earlyTechnicalScore * 0.12;
      } else if (q.runnerStage === "MATURE") {
        earlyTechnicalBoost = q.earlyTechnicalScore * 0.05;
      } else {
        earlyTechnicalBoost = q.earlyTechnicalScore * 0.02;
      }
      q.earlyTechnicalBoost = Number(earlyTechnicalBoost.toFixed(2));
      score += q.earlyTechnicalBoost;
      const strongEarlyTechnical =
        q.earlyTechnicalScore >= 70 &&
        ["IGNITION", "EXPANSION"].includes(q.runnerStage);
      if (strongEarlyTechnical && earlyTechnicalProfile.vwapCrossUp) score += 4;
      if (strongEarlyTechnical && earlyTechnicalProfile.hasRelativeStrength) score += 5;
      if (strongEarlyTechnical && earlyTechnicalProfile.atrExpansionRatio >= 1.5) score += 4;
      if (strongEarlyTechnical && earlyTechnicalProfile.dailyAtrExpansionRatio >= 1.5) score += 4;
    }
    if (q.lateChaseRisk) {
      score -= 25;
    }
    if (q.technicals) {
      const rsi = Number(q.technicals.rsi || 0);
      const ema9 = Number(q.technicals.ema9 || 0);
      const ema20 = Number(q.technicals.ema20 || 0);
      const macd = Number(q.technicals.macd || 0);
      const macdSignal = Number(q.technicals.macdSignal || 0);
      if (rsi >= 45 && rsi <= 70) score += 12;
      else if (rsi > 70 && rsi <= 80) score += 5;
      else if (rsi > 80) score -= 10;
      else if (rsi < 35) score -= 10;
      if (ema9 > ema20) score += 12;
      if (q.current > ema9 && ema9 > ema20) score += 10;
      if (macd > macdSignal) score += 12;
      if (macd > 0 && macdSignal > 0) score += 6;
    }
    // FIX-D: pull preMoveScore from memory into scoreStock for real-time boost
    const preMoverMem = engineState.preMoverDiscoveryMemory?.[normalizeSymbol(q.symbol || "")];
    if (preMoverMem && !q.preMoveScore) {
      q.preMoveScore = Number(preMoverMem.preMoveScore || 0);
      q.preMoverCompressionScore = Number(preMoverMem.compressionScore || 0);
      q.preMoverVolumeWakeupScore = Number(preMoverMem.volumeWakeupScore || 0);
    }
    if (Number(q.preMoveScore || 0) >= 82) {
      score += 14; // ELITE_PRE_MOVER in scoreStock real-time
      q.preMoveLabel = q.preMoveLabel || "ELITE_PRE_MOVER";
    } else if (Number(q.preMoveScore || 0) >= 72) {
      score += 8;
      q.preMoveLabel = q.preMoveLabel || "STRONG_PRE_MOVER";
    } else if (Number(q.preMoveScore || 0) >= 62) {
      score += 4;
      q.preMoveLabel = q.preMoveLabel || "DEVELOPING_PRE_MOVER";
    }
  
    const statisticalEdge =
      calculateStatisticalEdgeEngine(q);
    q.statisticalEdge = statisticalEdge;
    q.statisticalScore =
      statisticalEdge.statisticalEdgeScore;
    if (statisticalEdge.statisticalEdgeScore >= 85) score += 12;
    else if (statisticalEdge.statisticalEdgeScore >= 70) score += 8;
    else if (statisticalEdge.statisticalEdgeScore < 45) score -= 12;
    if (q.confirmations) {
      if (q.confirmations.volumeSpike) score += 12;
      if (q.confirmations.aboveVwap) score += 10;
      if (q.confirmations.closeNearHigh) score += 10;
      if (!q.confirmations.fakeBreakout) score += 8;
      if (!q.confirmations.gapTooHigh) score += 6;
      const premarketContinuationRelief =
        !engineState.marketOpen &&
        (
          isPremarketMomentumWindow() ||
          isMorningStrikeWindow()
        ) &&
        Number(
          q.premarketContinuationScore ||
          q.premarketDominanceScore ||
          q.openingDriveProbability ||
          q.continuationProbability ||
          q.breakoutProbability ||
          0
        ) >= 70;
      if (q.confirmations.fakeBreakout) score -= premarketContinuationRelief ? 8 : 25;
      if (q.confirmations.gapTooHigh) score -= premarketContinuationRelief ? 6 : 20;
      if (q.confirmations.newsRisk) score -= 30;
    }
    const premarketContinuationWindow =
      !engineState.marketOpen &&
      (
        isPremarketMomentumWindow() ||
        isMorningStrikeWindow()
      );
    if (premarketContinuationWindow) {
      const premarketMomentum =
        q.premarketMomentum ||
        calculatePremarketMomentumEngine(q);
      const premarketDominance =
        q.premarketDominance ||
        calculatePremarketDominanceEngine({
          ...q,
          premarketMomentum,
        });
      const continuationScore = Math.max(
        Number(premarketMomentum.openingDriveProbability || 0),
        Number(premarketMomentum.morningMomentumScore || 0),
        Number(premarketMomentum.gapContinuation?.openingRangeBreakoutProbability || 0),
        Number(premarketDominance.premarketDominanceScore || 0)
      );
      q.premarketMomentum = premarketMomentum;
      q.premarketDominance = premarketDominance;
      q.premarketContinuationScore = continuationScore;
      if (continuationScore >= 85) {
        score += 18;
        q.premarketContinuationBoost = 18;
      } else if (continuationScore >= 75) {
        score += 12;
        q.premarketContinuationBoost = 12;
      } else if (continuationScore >= 65) {
        score += 7;
        q.premarketContinuationBoost = 7;
      }
    }
    const phase5SignalQuality =
      calculateSignalQuality(q);
    q.phase5SignalQuality = phase5SignalQuality;
    q.institutionalSignalQuality = phase5SignalQuality;
    q.signalQualityScore = phase5SignalQuality.qualityScore;
    q.antiChaseRisk = phase5SignalQuality.antiChaseRisk;
    q.exhaustionRisk = phase5SignalQuality.exhaustionRisk;
    q.vwapExtensionPenalty = phase5SignalQuality.vwapExtensionPenalty;
    q.liquidityStabilityScore = phase5SignalQuality.liquidityStabilityScore;
    const phase6ScoringLayers =
      calculateScoringLayers(q, score);
    q.phase6ScoringLayers = phase6ScoringLayers;
    q.stockQualityScore = phase6ScoringLayers.stockQualityScore;
    q.tacticalMomentumScore = phase6ScoringLayers.tacticalMomentumScore;
    q.entryTimingScore = phase6ScoringLayers.entryTimingScore;
    q.executionConfidence = phase6ScoringLayers.executionConfidence;
    q.finalCompositeScore = phase6ScoringLayers.finalCompositeScore;
    q.finalTradeApproval = phase6ScoringLayers.finalTradeApproval;
    q.riskAdjustedSizingMultiplier =
      phase6ScoringLayers.riskAdjustedSizingMultiplier;
    applyInstitutionalArchitecture(q);
  
    // FIX10: 700% runner engine — boosts score for explosive low-float candidates
    const runner700 = calculateExplosiveRunnerScore700(q);
    q.runner700 = runner700;
    q.score700 = runner700.score700;
    q.runner700Label = runner700.runner700Label;
    if (runner700.score700 >= 85) {
      score += 20; // elite explosive candidate — significant boost
    } else if (runner700.score700 >= 72) {
      score += 12;
    } else if (runner700.score700 >= 58) {
      score += 6;
    }
  
  const legacyCompositeScore = clampScore(
    score + Number(phase6ScoringLayers.scoreAdjustment || 0)
  );
    q.legacyCompositeScore = legacyCompositeScore;
    q.discoveryScorecard = calculateEarlyDiscoveryScore(q);
    q.discoveryScore = q.discoveryScorecard.score;
    q.discoveryTier = q.discoveryScorecard.tier;
    q.entryQualityScorecard = calculateEntryQualityScore(q);
    q.entryQualityScore = q.entryQualityScorecard.score;
    const separatedEntryApproval = q.entryQualityScorecard.tier === "BLOCKED"
      ? "BLOCK"
      : q.entryQualityScore >= 72
        ? "APPROVED"
        : q.entryQualityScore >= 60
          ? "WATCHLIST_WAIT_FOR_ENTRY"
          : "REJECT_WEAK_TIMING";
    q.phase6ScoringLayers = {
      ...q.phase6ScoringLayers,
      legacyFinalTradeApproval: q.phase6ScoringLayers?.finalTradeApproval,
      finalTradeApproval: separatedEntryApproval,
      separatedEntryQualityScore: q.entryQualityScore,
    };
    q.finalTradeApproval = separatedEntryApproval;
    score = q.entryQualityScore;
  
    if (q.runnerStage === "EXHAUSTION" || q.lateChaseRisk) {
      q.blockBuying = true;
      q.buyBlocked = true;
      q.discoveryOnly = true;
      q.buyBlockReason =
        q.buyBlockReason ||
        (q.runnerStage === "EXHAUSTION"
          ? "Runner exhaustion risk"
          : "Late chase risk");
  
      score = Math.min(score, 35);
  
      if (q.parabolicRunnerCandidate === true || q.explosiveMoveCandidate === true) {
        q.discoveryScore = Math.max(Number(q.discoveryScore || 0), 82);
        q.discoveryTier = "DISCOVERY_ONLY_PARABOLIC_RUNNER";
      }
    } else if (q.runnerStage === "MATURE") {
      score = Math.min(score, 84);
    } else if (q.runnerStage === "WATCHING") {
      score = Math.min(score, 78);
    }
  
    q.entryScore = clampScoreFinal(score);
    q.entryQualityScore = q.entryScore;
    q.decisionScoreTelemetry = buildDecisionScoreTelemetry(q);
    return q.entryScore;
  
  }
  
  async function scanMarket() {
    if (activeScanLocks.scanMarket) {
      console.warn("scanMarket skipped: scan already running");
      return Array.isArray(engineState.lastStockSignals)
        ? engineState.lastStockSignals
        : [];
    }
    activeScanLocks.scanMarket = true;
    try {
      const scanCycleId = `STOCK_SCAN_${Date.now()}`;
      engineState.currentStockScanCycleId = scanCycleId;
      engineState.lastStockScanStartedAt = new Date().toISOString();
      const account = await getAccount();
      const positions = await getPositions();
      const aiOwnedSymbols = await getBotOwnedSymbols();
      const managedPositions = positions.filter((position) =>
        aiOwnedSymbols.has(normalizeSymbol(position.symbol)) ||
        engineState.aiManagedSymbols?.includes(normalizeSymbol(position.symbol))
      );
      engineState.cachedAccount = account;
      engineState.cachedPositions = positions;
      engineState.staleSnapshotClearReason =
        "NEW_STOCK_SCAN_STARTED_KEEP_LAST_GOOD_DASHBOARD";
      engineState.lastStockScanPreservedDashboardAt =
        new Date().toISOString();
      const symbols = await getTopMovers();
      const limitedSymbols = narrowScanUniverse(symbols);
      engineState.skippedSymbols = [];
      console.log(`Scanning ${limitedSymbols.length} of ${symbols.length} symbols...`);
      console.log("Advanced filters enabled:", CONFIG.enableAdvancedFilters);
      const batchSize = 2;
      const rawResults = await processBatches(limitedSymbols, batchSize, async (symbol) => {
        try {
          const assetCheck = await checkAssetEligibility(symbol);
          if (!assetCheck.ok) {
            recordSkippedSymbol(symbol, assetCheck.reason);
            return null;
          }
          const quote = await getStockQuote(symbol);
          const stockIdentity = await getStockIdentity(
            symbol,
            assetCheck.asset || {}
          );
          if (!quote || typeof quote !== "object") {
            recordSkippedSymbol(
              symbol,
              `No valid quote object returned for ${symbol}`
            );
            return null;
          }
          Object.assign(quote, {
            companyName: stockIdentity.companyName || "",
            displayName: stockIdentity.displayName || "",
            assetName: stockIdentity.assetName || "",
            name: stockIdentity.name || "",
            tickerName: stockIdentity.tickerName || "",
            securityName: stockIdentity.securityName || "",
            nameSource: stockIdentity.nameSource || "not_found",
          });
          const technicalBars =
            Array.isArray(quote.stockChartBars) &&
              quote.stockChartBars.length > 0
              ? quote.stockChartBars.map((bar) => ({
                c: Number(bar.close || 0),
                h: Number(bar.high || 0),
                l: Number(bar.low || 0),
                o: Number(bar.open || 0),
                v: Number(bar.volume || 0),
                t: bar.time,
              }))
              : [];
          quote.technicals = computeTechnicals(technicalBars);
          if (CONFIG.enableAdvancedFilters) {
            quote.confirmations = await getAdvancedConfirmations(quote);
          }
          const premarketContinuationWindow =
            !engineState.marketOpen &&
            (
              isPremarketMomentumWindow() ||
              isMorningStrikeWindow()
            );
          if (premarketContinuationWindow) {
            quote.premarketMomentum =
              calculatePremarketMomentumEngine(quote);
            quote.premarketDominance =
              calculatePremarketDominanceEngine(quote);
            quote.premarketDominanceScore =
              Number(quote.premarketDominance?.premarketDominanceScore || 0);
            quote.morningMomentumScore =
              Number(quote.premarketMomentum?.morningMomentumScore || 0);
            quote.openingDriveProbability =
              Number(quote.premarketMomentum?.openingDriveProbability || 0);
            quote.continuationProbability = Math.max(
              Number(quote.continuationProbability || 0),
              Number(quote.premarketMomentum?.gapContinuation?.openingRangeBreakoutProbability || 0),
              Number(quote.premarketMomentum?.openingDriveProbability || 0)
            );
            quote.breakoutProbability = Math.max(
              Number(quote.breakoutProbability || 0),
              Number(quote.premarketMomentum?.gapContinuation?.openingRangeBreakoutProbability || 0)
            );
          }
          const quality = passesFilters(quote);
          if (!quality.ok) {
            const premarketContinuationScore = Math.max(
              Number(quote.premarketContinuationScore || 0),
              Number(quote.premarketDominanceScore || 0),
              Number(quote.morningMomentumScore || 0),
              Number(quote.openingDriveProbability || 0),
              Number(quote.continuationProbability || 0),
              Number(quote.breakoutProbability || 0)
            );
            const allowPremarketDisplay =
              premarketContinuationWindow &&
              premarketContinuationScore >= 70 &&
              /fake|breakout|gap|vwap|extended|chase/i.test(String(quality.reason || ""));
            if (!allowPremarketDisplay) {
              recordSkippedSymbol(symbol, quality.reason);
              return null;
            }
            quote.displayOnly = true;
            quote.blockBuying = true;
            quote.displayOnlyReason =
              `PREMARKET_CONTINUATION_DISPLAY_ONLY: ${quality.reason || "quality filter"}`;
          }
          quote.displayOnly = quote.displayOnly === true || quality.displayOnly === true;
          quote.blockBuying =
            quote.blockBuying === true ||
            quality.blockBuying === true ||
            quality.buyBlocked === true;
  
          quote.buyBlocked =
            quote.buyBlocked === true ||
            quality.buyBlocked === true;
  
          quote.discoveryOnly =
            quote.discoveryOnly === true ||
            quality.discoveryOnly === true;
          quote.displayOnlyReason = quote.displayOnlyReason || quality.reason || "";
  
          const score = scoreStock(quote);
          const statisticalEdge = quote.statisticalEdge || null;
          const statisticalScore = Number(quote.statisticalScore || 0);
          const institutional = calculateInstitutionalScores({
            ...quote,
            score,
          });
          const accumulationIntelligence =
            calculateAccumulationEngine({
              ...quote,
              score: institutional.institutionalScore,
              statisticalScore,
              statisticalEdge,
              ...institutional,
            });
          const volatilityCompression =
            calculateVolatilityCompressionEngine({
              ...quote,
              score: institutional.institutionalScore,
              statisticalScore,
              statisticalEdge,
              ...institutional,
            });
          const catalystRanking =
            calculateCatalystRankingEngine({
              ...quote,
              score: institutional.institutionalScore,
              statisticalScore,
              statisticalEdge,
              ...institutional,
            });
          const explosiveRunnerPrediction =
            calculateExplosiveRunnerPrediction({
              ...quote,
              score: institutional.institutionalScore,
              statisticalScore,
              statisticalEdge,
              ...institutional,
              accumulationIntelligence,
              volatilityCompression,
              catalystRanking,
            });
          const earlyStrengthProjection =
            calculateEarlyStrengthProjection({
              ...quote,
              score: institutional.institutionalScore,
              momentumScore: institutional.momentumScore || score,
              statisticalScore,
              statisticalEdge,
              ...institutional,
              accumulationIntelligence,
              volatilityCompression,
              catalystRanking,
              explosiveRunnerPrediction,
            });
          const portfolioManagerInput = {
            ...quote,
            score: institutional.institutionalScore,
            legacyMomentumScore: score,
            discoveryScore: Number(quote.discoveryScore || 0),
            discoveryTier: quote.discoveryTier || "LOW_DISCOVERY",
            discoveryScorecard: quote.discoveryScorecard || null,
            entryScore: Number(quote.entryScore || score || 0),
            entryQualityScore: Number(quote.entryQualityScore || score || 0),
            entryQualityScorecard: quote.entryQualityScorecard || null,
            legacyCompositeScore: Number(quote.legacyCompositeScore || 0),
            decisionScoreTelemetry: quote.decisionScoreTelemetry || null,
            momentumScore:
              institutional.momentumScore || score,
            fundamentalBlendScore:
              institutional.fundamentalBlendScore || 0,
            reinforcementWeights:
              institutional.reinforcementWeights ||
              engineState.reinforcementWeightState?.weights ||
              {},
            statisticalScore,
            statisticalEdge,
            accumulationIntelligence,
            volatilityCompression,
            catalystRanking,
            explosiveRunnerPrediction,
            explosiveRunnerScore:
              explosiveRunnerPrediction.explosiveRunnerScore,
            explosiveRunnerLabel:
              explosiveRunnerPrediction.runnerLabel,
            earlyStrengthProjection,
            earlyProjectionScore:
              earlyStrengthProjection.earlyProjectionScore,
            earlyProjectionTier:
              earlyStrengthProjection.earlyProjectionTier,
            ...institutional,
          };
          const portfolioManager =
            typeof calculateAiPortfolioManagerDecision === "function"
              ? calculateAiPortfolioManagerDecision(
                portfolioManagerInput,
                engineState.cachedAccount || {},
                engineState.cachedPositions || [],
                engineState.marketRegime || detectMarketRegime([])
              )
              : {
                approved: true,
                autoTradeApproved: true,
                aiPortfolioAction: "ALLOW",
                portfolioAction: "ALLOW",
                portfolioScore: 50,
                recommendedTradeAmount: 0,
                aiAllocationPercentOfBotBudget: 0,
                portfolioManagerReason:
                  "AI_PORTFOLIO_MANAGER_UNAVAILABLE",
              };
          if (!engineState.previousSignalApprovals) {
            engineState.previousSignalApprovals = {};
          }
          const previousApproval =
            engineState.previousSignalApprovals[
            normalizeSymbol(quote.symbol)
            ];
          const currentApproval =
            quote.phase6ScoringLayers?.finalTradeApproval ||
            "UNKNOWN";
          if (
            previousApproval &&
            previousApproval !== currentApproval
          ) {
            broadcastTapeEvent("APPROVAL_CHANGED", {
              symbol: quote.symbol,
              previousApproval,
              currentApproval,
              score,
              executionConfidence: quote.executionConfidence || 0,
            });
          }
          engineState.previousSignalApprovals[
            normalizeSymbol(quote.symbol)
          ] = currentApproval;
          return {
            ...quote,
            scanCycleId,
            scanBuiltAt: new Date().toISOString(),
            quoteFetchedAt: quote.quoteFetchedAt || new Date().toISOString(),
            score: institutional.institutionalScore,
            legacyMomentumScore: score,
            momentumScore:
              institutional.momentumScore || score,
            fundamentalBlendScore:
              institutional.fundamentalBlendScore || 0,
            reinforcementWeights:
              institutional.reinforcementWeights ||
              engineState.reinforcementWeightState?.weights ||
              {},
            statisticalScore,
            statisticalEdge,
            phase5SignalQuality: quote.phase5SignalQuality || null,
            institutionalSignalQuality:
              quote.institutionalSignalQuality || null,
            signalQualityScore:
              Number(quote.signalQualityScore || 0),
            antiChaseRisk:
              Number(quote.antiChaseRisk || 0),
            exhaustionRisk:
              Number(quote.exhaustionRisk || 0),
            vwapExtensionPenalty:
              Number(quote.vwapExtensionPenalty || 0),
            liquidityStabilityScore:
              Number(quote.liquidityStabilityScore || 0),
            phase6ScoringLayers:
              quote.phase6ScoringLayers || null,
            stockQualityScore:
              Number(quote.stockQualityScore || 0),
            tacticalMomentumScore:
              Number(quote.tacticalMomentumScore || 0),
            entryTimingScore:
              Number(quote.entryTimingScore || 0),
            executionConfidence:
              Number(quote.executionConfidence || 0),
            finalCompositeScore:
              Number(quote.finalCompositeScore || 0),
            finalTradeApproval:
              quote.finalTradeApproval || "UNKNOWN",
            riskAdjustedSizingMultiplier:
              Number(quote.riskAdjustedSizingMultiplier || 0),
            accumulationIntelligence,
            volatilityCompression,
            catalystRanking,
            explosiveRunnerPrediction,
            explosiveRunnerScore:
              explosiveRunnerPrediction.explosiveRunnerScore,
            explosiveRunnerLabel:
              explosiveRunnerPrediction.runnerLabel,
            earlyStrengthProjection,
            earlyProjectionScore:
              earlyStrengthProjection.earlyProjectionScore,
            earlyProjectionTier:
              earlyStrengthProjection.earlyProjectionTier,
            ...institutional,
            ...portfolioManager,
            qualifiedToBuy:
              quote.blockBuying === true
                ? false
                : (
                  institutional.autoTradeApproved === true ||
                  portfolioManager.autoTradeApproved === true ||
                  portfolioManager.approved === true ||
                  portfolioManager.aiPortfolioAction === "ALLOW" ||
                  portfolioManager.portfolioAction === "ALLOW"
                ) &&
                institutional.decisionLevel !== "Visible Stock" &&
                quote.phase6ScoringLayers?.hardReject !== true &&
                quote.phase6ScoringLayers?.finalTradeApproval !== "REJECT_WEAK_TIMING" &&
                quote.phase6ScoringLayers?.finalTradeApproval !== "BLOCK" &&
                engineState.phase20AutonomousOrchestrationState?.shouldBlockNewTrades !== true &&
                engineState.phase21AutonomousBrainState?.shouldBlockNewTrades !== true,
            autoTradeApproved:
              quote.blockBuying === true
                ? false
                : portfolioManager.autoTradeApproved,
            displayOnly: quote.displayOnly === true,
            displayOnlyReason: quote.displayOnlyReason || "",
          };
        } catch (err) {
          recordSkippedSymbol(symbol, err.message);
          return null;
        }
      });
      const results = rawResults.filter(Boolean);
      const skipReasonCounts = (engineState.skippedSymbols || []).reduce(
        (acc, item) => {
          const reason = item.reason || "Unknown";
          acc[reason] = (acc[reason] || 0) + 1;
          return acc;
        },
        {}
      );
      console.log("SCAN DEEP DEBUG", {
        scannedUniverse: limitedSymbols.length,
        rawResults: rawResults.length,
        finalResults: results.length,
        skippedCount: engineState.skippedSymbols.length,
        skipReasonCounts,
        topSkipped: engineState.skippedSymbols.slice(0, 10),
      });
      console.log(`Scan finished. Found ${results.length} stocks.`);
  
      results.forEach((s) => {
        console.log("APPROVAL DEBUG", s.symbol, {
          approved: s.approved,
          autoTradeApproved: s.autoTradeApproved,
  
          institutionalScore: s.institutionalScore,
          score: s.score,
  
          decisionLevel: s.decisionLevel,
  
          blockBuying: s.blockBuying,
  
          finalTradeApproval:
            s.phase6ScoringLayers?.finalTradeApproval,
  
          hardReject:
            s.phase6ScoringLayers?.hardReject,
  
          recommendedTradeAmount:
            s.recommendedTradeAmount,
  
          portfolioAction:
            s.portfolioAction,
  
          aiPortfolioAction:
            s.aiPortfolioAction,
  
          displayOnly:
            s.displayOnly,
  
          displayOnlyReason:
            s.displayOnlyReason,
        });
      });
  
      console.log(
        "APPROVED COUNT:",
        results.filter(
          (s) => s.approved === true || s.autoTradeApproved === true
        ).length
      );
      let multiDayAccumulationState = {
        reviewedCount: 0,
        preBreakoutCount: 0,
        topTwoSymbols: [],
      };
  
      try {
        if (
          typeof updateMultiDayAccumulationState === "function" &&
          Array.isArray(results) &&
          results.length > 0
        ) {
          multiDayAccumulationState =
            updateMultiDayAccumulationState(results);
        } else {
          engineState.multiDayAccumulationState = {
            updatedAt: new Date().toISOString(),
            phase: "27_MULTI_DAY_ACCUMULATION_MEMORY",
            reviewedCount: 0,
            memorySymbolCount: Object.keys(
              engineState.multiDayAccumulationMemory || {}
            ).length,
            preBreakoutCount: 0,
            preBreakoutCandidates: [],
            topTwoSymbols: [],
            reason: "No scan results to review.",
          };
        }
  
        if (typeof recordOrder === "function") {
          recordOrder("MULTI_DAY_ACCUMULATION_UPDATED", "STOCK", {
            reviewedCount: multiDayAccumulationState.reviewedCount,
            preBreakoutCount: multiDayAccumulationState.preBreakoutCount,
            topTwoSymbols: multiDayAccumulationState.topTwoSymbols,
          });
        }
      } catch (err) {
        console.error("MULTI_DAY_ACCUMULATION_ERROR", {
          message: err.message,
          stack: err.stack,
        });
  
        engineState.multiDayAccumulationState = {
          updatedAt: new Date().toISOString(),
          phase: "27_MULTI_DAY_ACCUMULATION_MEMORY",
          reviewedCount: 0,
          preBreakoutCount: 0,
          topTwoSymbols: [],
          error: err.message,
          reason: "Multi-day accumulation failed safely.",
        };
      }
      for (const signal of results) {
        const sym = normalizeSymbol(signal.symbol);
  
        // FIX-A1: Attach multiDayAccumulation (pre-breakout multi-day memory)
        const accumMemory = engineState.multiDayAccumulationMemory?.[sym];
        if (accumMemory) {
          signal.multiDayAccumulation = accumMemory;
          signal.multiDayAccumulationScore = Number(accumMemory.preBreakoutScore || 0);
          // Upgraded: scale boost by how strong the pre-breakout signal is
          if (signal.multiDayAccumulationScore >= 85) {
            signal.score = clampScore(Number(signal.score || 0) + 14);
            signal.multiDayAccumulationBoost = 14;
          } else if (signal.multiDayAccumulationScore >= 75) {
            signal.score = clampScore(Number(signal.score || 0) + 9);
            signal.multiDayAccumulationBoost = 9;
          } else if (signal.multiDayAccumulationScore >= 65) {
            signal.score = clampScore(Number(signal.score || 0) + 5);
            signal.multiDayAccumulationBoost = 5;
          }
        }
        signal.continuationScorecard = calculateMultiDayContinuationScore(signal);
        signal.multiDayContinuationScore = signal.continuationScorecard.score;
        signal.multiDayContinuationTier = signal.continuationScorecard.tier;
  
        // FIX-A2: Attach preMoveScore and use it as a score boost
        // This was computed but NEVER fed into signal scoring — now it does
        const preMoverMemory = engineState.preMoverDiscoveryMemory?.[sym];
        if (preMoverMemory) {
          signal.preMoverDiscovery = preMoverMemory;
          signal.preMoveScore = Number(preMoverMemory.preMoveScore || 0);
          signal.preMoverCompressionScore = Number(preMoverMemory.compressionScore || 0);
          signal.preMoverAccumulationScore = Number(preMoverMemory.accumulationScore || 0);
          signal.preMoverVolumeWakeupScore = Number(preMoverMemory.volumeWakeupScore || 0);
          // Strong pre-move fingerprint = before-the-move detection bonus
          if (signal.preMoveScore >= 82) {
            signal.score = clampScore(Number(signal.score || 0) + 16);
            signal.preMoveBoost = 16;
            signal.preMoveLabel = "ELITE_PRE_MOVER";
          } else if (signal.preMoveScore >= 74) {
            signal.score = clampScore(Number(signal.score || 0) + 10);
            signal.preMoveBoost = 10;
            signal.preMoveLabel = "STRONG_PRE_MOVER";
          } else if (signal.preMoveScore >= 65) {
            signal.score = clampScore(Number(signal.score || 0) + 5);
            signal.preMoveBoost = 5;
            signal.preMoveLabel = "DEVELOPING_PRE_MOVER";
          }
        }
        // Build telemetry only after all persisted discovery evidence is attached.
        signal.discoveryScorecard = calculateEarlyDiscoveryScore(signal);
        signal.discoveryScore = signal.discoveryScorecard.score;
        signal.discoveryTier = signal.discoveryScorecard.tier;
        signal.decisionScoreTelemetry = buildDecisionScoreTelemetry(signal);
      }
      try {
        const latestAccountForPyramids = await getAccount();
        const latestPositionsForPyramids = await getPositions();
        const aiOwnedSymbolsForPyramids = await getBotOwnedSymbols();
        const openAiPositionsForPyramids =
          latestPositionsForPyramids.filter((position) =>
            aiOwnedSymbolsForPyramids.has(normalizeSymbol(position.symbol))
          );
        const pyramidAdds = await executePyramidScalingAdds(
          results,
          latestAccountForPyramids,
          openAiPositionsForPyramids
        );
        if (pyramidAdds.length > 0) {
          recordOrder("PYRAMID_ENGINE_COMPLETED", "PORTFOLIO", {
            executedAdds: pyramidAdds.length,
            symbols: pyramidAdds.map((item) => item.symbol),
          });
        }
      } catch (err) {
        recordFailedOrder(
          "PYRAMID_ENGINE_FAILED",
          "PORTFOLIO",
          err.message
        );
      }
      const adaptiveRunnerLearningState =
        updateAdaptiveRunnerLearningState(results);
      recordOrder("ADAPTIVE_RUNNER_LEARNING_UPDATED", "STOCK", {
        reviewedCount: adaptiveRunnerLearningState.reviewedCount,
        learnedRunnerCount:
          adaptiveRunnerLearningState.learnedRunnerCount,
        topTwoSymbols: adaptiveRunnerLearningState.topTwoSymbols,
      });
      for (const signal of results) {
        const adaptiveRunnerLearning =
          calculateAdaptiveRunnerLearning(signal);
        signal.adaptiveRunnerLearning = adaptiveRunnerLearning;
        signal.adaptiveRunnerScore =
          adaptiveRunnerLearning.breakoutProbability;
        signal.runnerScore =
          Number(
            signal.explosiveRunnerScore ||
            signal.explosiveRunnerPrediction?.explosiveRunnerScore ||
            signal.adaptiveRunnerScore ||
            adaptiveRunnerLearning.breakoutProbability ||
            0
          );
        if (
          Number(adaptiveRunnerLearning.adaptiveRunnerBoost || 0) !== 0
        ) {
          signal.score = clampScore(
            Number(signal.score || 0) +
            Number(adaptiveRunnerLearning.adaptiveRunnerBoost || 0)
          );
        }
      }
      applyFastRunnerOverride(results);
      const explosiveRunnerState =
        updateExplosiveRunnerState(results);
      recordOrder("EXPLOSIVE_RUNNER_UPDATED", "STOCK", {
        reviewedCount: explosiveRunnerState.reviewedCount,
        topEarlyRunnerCount: explosiveRunnerState.topEarlyRunnerCount,
        topTwoSymbols: explosiveRunnerState.topTwoSymbols,
      });
  
      const swingWatchlistState =
        updateSwingWatchlistState(results);
  
      recordOrder("SWING_WATCHLIST_UPDATED", "STOCK", {
        reviewedCount: swingWatchlistState.reviewedCount,
        topSwingCount: swingWatchlistState.top25.length,
        highConfidenceCount: swingWatchlistState.highConfidenceStocks.length,
        topTwoSymbols: swingWatchlistState.top10
          .slice(0, 2)
          .map((item) => item.symbol),
      });
      const autonomousCapitalRotationState =
        updateAutonomousCapitalRotationState(results);
      recordOrder(
        "AUTONOMOUS_CAPITAL_ROTATION_UPDATED",
        "PORTFOLIO",
        {
          stockAllocation:
            autonomousCapitalRotationState.stockAllocation,
          cryptoAllocation:
            autonomousCapitalRotationState.cryptoAllocation,
          cashReserve:
            autonomousCapitalRotationState.cashReserve,
          dominantAllocator:
            autonomousCapitalRotationState.dominantAllocator,
        }
      );
      const allocationAdjustedResults =
        results.map((signal) =>
          applyAutonomousCapitalRotation(signal)
        );
      results.length = 0;
      results.push(...allocationAdjustedResults);
      const institutionalExecutionLayerState =
        updateInstitutionalExecutionLayerState(results);
      recordOrder("INSTITUTIONAL_EXECUTION_LAYER_UPDATED", "EXECUTION", {
        reviewedCount:
          institutionalExecutionLayerState.reviewedCount,
        executableCount:
          institutionalExecutionLayerState.executableCount,
        averageExecutionConfidence:
          institutionalExecutionLayerState.averageExecutionConfidence,
      });
      for (const signal of results) {
        const executionPlan =
          calculateInstitutionalExecutionPlan(signal, 0);
        const relaxedExecutionPlan =
          applySmallCapRunnerExecutionRelaxation(
            signal,
            executionPlan
          );
        signal.institutionalExecutionPlan = relaxedExecutionPlan;
        signal.executionConfidence =
          relaxedExecutionPlan.executionConfidence;
        if (relaxedExecutionPlan.executionMode === "AVOID_WEAK_EXECUTION") {
          signal.score = clampScore(Number(signal.score || 0) - 6);
          signal.executionPenalty = 6;
        }
        if (relaxedExecutionPlan.executionConfidence >= 68) {
          signal.score = clampScore(Number(signal.score || 0) + 3);
          signal.executionQualityBoost = 3;
        }
      }
      for (const signal of results) {
        const phase15ExecutionDominance =
          calculatePhase15AutonomousExecutionDominance(signal, 0);
        signal.phase15ExecutionDominance =
          phase15ExecutionDominance;
        signal.executionDominanceScore =
          phase15ExecutionDominance.executionDominanceScore;
        if (phase15ExecutionDominance.blockExecution) {
          signal.qualifiedToBuy = false;
          signal.phase15ExecutionBlocked = true;
          signal.phase15ExecutionBlockReason =
            phase15ExecutionDominance.reason;
        }
        if (
          phase15ExecutionDominance.executionDominanceScore >= 72 &&
          !phase15ExecutionDominance.blockExecution
        ) {
          signal.score = clampScore(Number(signal.score || 0) + 2);
          signal.phase15ExecutionBoost = 2;
        }
      }
      const phase15ExecutionDominanceState =
        updatePhase15ExecutionDominanceState(results);
      recordOrder("PHASE_15_EXECUTION_DOMINANCE_UPDATED", "EXECUTION", {
        reviewedCount:
          phase15ExecutionDominanceState.reviewedCount,
        dominantExecutionCount:
          phase15ExecutionDominanceState.dominantExecutionCount,
        blockedExecutionCount:
          phase15ExecutionDominanceState.blockedExecutionCount,
        averageExecutionDominance:
          phase15ExecutionDominanceState.averageExecutionDominance,
      });
      const autonomousMarketIntelligenceState =
        updateAutonomousMarketIntelligenceState(
          results
        );
      recordOrder(
        "AUTONOMOUS_MARKET_INTELLIGENCE_UPDATED",
        "MARKET",
        {
          marketAdaptationLevel:
            autonomousMarketIntelligenceState.marketAdaptationLevel,
          marketPersonality:
            autonomousMarketIntelligenceState
              .marketPersonality?.personality,
          selfOptimizationReadiness:
            autonomousMarketIntelligenceState
              .selfOptimizationReadiness,
        }
      );
      const fullInstitutionalAiBrainState =
        updateFullInstitutionalAiBrainState(results);
      recordOrder(
        "FULL_INSTITUTIONAL_AI_BRAIN_UPDATED",
        "BRAIN",
        {
          reviewedCount:
            fullInstitutionalAiBrainState.reviewedCount,
          masterOpportunityCount:
            fullInstitutionalAiBrainState.masterOpportunityCount,
          topTwoSymbols:
            fullInstitutionalAiBrainState.topTwoSymbols,
        }
      );
      for (const signal of results) {
        const rankedSignal =
          fullInstitutionalAiBrainState.rankedOpportunities.find(
            (item) => normalizeSymbol(item.symbol) === normalizeSymbol(signal.symbol)
          );
        if (rankedSignal?.fullInstitutionalAiBrain) {
          signal.fullInstitutionalAiBrain =
            rankedSignal.fullInstitutionalAiBrain;
          signal.institutionalBrainScore =
            rankedSignal.institutionalBrainScore;
          if (
            rankedSignal.fullInstitutionalAiBrain.brainAction === "PRIORITIZE"
          ) {
            signal.score = clampScore(Number(signal.score || 0) + 5);
            signal.fullBrainBoost = 5;
          }
        }
      }
      const themeMomentumState =
        calculateThemeMomentumEngine(results);
      recordOrder("THEME_MOMENTUM_UPDATED", "STOCK", {
        reviewedCount: themeMomentumState.reviewedCount,
        leadingThemeCount: themeMomentumState.leadingThemeCount,
        leadingThemes: themeMomentumState.leadingThemes?.map(
          (theme) => theme.theme
        ),
      });
      const themeBoostedResults =
        results.map((signal) => applyThemeMomentumBoost(signal));
      results.length = 0;
      results.push(...themeBoostedResults);
      const refreshedFullInstitutionalAiBrainState =
        updateFullInstitutionalAiBrainState(results);
      for (const signal of results) {
        const rankedSignal =
          refreshedFullInstitutionalAiBrainState.rankedOpportunities.find(
            (item) => normalizeSymbol(item.symbol) === normalizeSymbol(signal.symbol)
          );
        if (rankedSignal?.fullInstitutionalAiBrain) {
          signal.fullInstitutionalAiBrain =
            rankedSignal.fullInstitutionalAiBrain;
          signal.institutionalBrainScore =
            Number(rankedSignal.institutionalBrainScore || 0);
        }
      }
      const statisticalEdgeSignals = results.filter(
        (signal) => Number(signal.statisticalScore || 0) >= 70
      );
      const averageStatisticalEdge =
        statisticalEdgeSignals.length > 0
          ? statisticalEdgeSignals.reduce(
            (sum, signal) => sum + Number(signal.statisticalScore || 0),
            0
          ) / statisticalEdgeSignals.length
          : 0;
      engineState.statisticalMemoryState =
        engineState.statisticalMemoryState || {
          updatedAt: null,
          setupHistory: [],
          setupPerformance: {},
          expectancyHistory: [],
          probabilityHistory: [],
        };
      engineState.statisticalEdgeState = {
        updatedAt: new Date().toISOString(),
        qualifyingSignals: statisticalEdgeSignals.length,
        averageStatisticalEdge: Number(averageStatisticalEdge.toFixed(2)),
        strongestSignals: statisticalEdgeSignals.slice(0, 5).map((signal) => ({
          symbol: signal.symbol,
          score: signal.score,
          statisticalScore: signal.statisticalScore,
        })),
      };
      if (!Array.isArray(engineState.statisticalEdgeHistory)) {
        engineState.statisticalEdgeHistory = [];
      }
      engineState.statisticalEdgeHistory.unshift({
        updatedAt: new Date().toISOString(),
        qualifyingSignals: statisticalEdgeSignals.length,
        averageStatisticalEdge: Number(averageStatisticalEdge.toFixed(2)),
      });
      engineState.statisticalEdgeHistory = engineState.statisticalEdgeHistory.slice(
        0,
        200
      );
      const continuationHoldState =
        updateContinuationHoldState(results);
      recordOrder("CONTINUATION_HOLD_UPDATED", "STOCK", {
        reviewedCount: continuationHoldState.reviewedCount,
        qualifiedHoldCount: continuationHoldState.qualifiedHoldCount,
        selectedHoldSymbol: continuationHoldState.selectedHoldSymbol,
      });
      const premarketMomentumState =
        updatePremarketMomentumState(results);
      recordOrder("PREMARKET_MOMENTUM_UPDATED", "STOCK", {
        reviewedCount: premarketMomentumState.reviewedCount,
        eliteCount: premarketMomentumState.eliteCount,
        topTwoSymbols: premarketMomentumState.topTwoSymbols,
      });
      const premarketDominanceState =
        updatePremarketDominanceState(results);
      recordOrder("PREMARKET_DOMINANCE_UPDATED", "STOCK", {
        reviewedCount: premarketDominanceState.reviewedCount,
        sniperCount: premarketDominanceState.sniperCount,
        topTwoSymbols: premarketDominanceState.topTwoSymbols,
      });
      for (const signal of results) {
        signal.premarketDominance =
          calculatePremarketDominanceEngine(signal);
        signal.premarketDominanceScore =
          Number(signal.premarketDominance?.premarketDominanceScore || 0);
        if (
          Number(signal.premarketDominance.premarketDominanceScore || 0) >= 75
        ) {
          signal.score = clampScore(Number(signal.score || 0) + 5);
          signal.premarketDominanceBoost = 5;
        }
      }
      const finalFullInstitutionalAiBrainState =
        updateFullInstitutionalAiBrainState(results);
      for (const signal of results) {
        const rankedSignal =
          finalFullInstitutionalAiBrainState.rankedOpportunities.find(
            (item) =>
              normalizeSymbol(item.symbol) === normalizeSymbol(signal.symbol)
          );
        if (rankedSignal?.fullInstitutionalAiBrain) {
          signal.fullInstitutionalAiBrain =
            rankedSignal.fullInstitutionalAiBrain;
          signal.institutionalBrainScore =
            Number(rankedSignal.institutionalBrainScore || 0);
        }
        signal.runnerScore =
          Number(
            signal.explosiveRunnerScore ||
            signal.explosiveRunnerPrediction?.explosiveRunnerScore ||
            signal.adaptiveRunnerScore ||
            0
          );
        signal.premarketDominanceScore =
          Number(
            signal.premarketDominance?.premarketDominanceScore ||
            signal.premarketDominanceScore ||
            signal.explosiveRunnerPrediction?.premarket?.openingDriveProbability ||
            signal.explosiveRunnerPrediction?.premarket?.morningMomentumScore ||
            0
          );
      }
      for (const signal of results) {
        const phase7Reinforcement =
          calculatePhase7ReinforcementLearning(signal);
        signal.phase7Reinforcement = phase7Reinforcement;
        signal.setupTrustScore = phase7Reinforcement.setupTrustScore;
        signal.setupTrustLabel = phase7Reinforcement.trustLabel;
        signal.phase7ProbabilityAdjustment =
          phase7Reinforcement.probabilityAdjustment;
        signal.phase7SizingMultiplier =
          phase7Reinforcement.learnedSizingMultiplier;
        if (Number(phase7Reinforcement.probabilityAdjustment || 0) !== 0) {
          signal.score = clampScore(
            Number(signal.score || 0) +
            Number(phase7Reinforcement.probabilityAdjustment || 0)
          );
        }
        const phase9LiquidityIntelligence =
          signal.phase9LiquidityIntelligence ||
          calculatePhase9LiquidityIntelligence(signal);
        if (
          phase9LiquidityIntelligence.liquidityLabel === "WEAK_LIQUIDITY_TRAP" &&
          Number(signal.score || 0) < 82
        ) {
          recordOrder(
            "AUTO_STOCK_BUY_SKIPPED_PHASE_9_WEAK_LIQUIDITY",
            signal.symbol,
            {
              score: signal.score,
              phase9LiquidityIntelligence,
              reason:
                "Phase 9 blocked entry because liquidity quality is weak.",
            }
          );
          continue;
        }
        if (phase7Reinforcement.suppressEntry) {
          signal.qualifiedToBuy = false;
          signal.phase7Suppressed = true;
          signal.phase7SuppressionReason = phase7Reinforcement.reason;
        }
      }
      const phase7ReinforcementLearningState =
        updatePhase7ReinforcementLearningState(results);
      recordOrder(
        "PHASE_7_REINFORCEMENT_LEARNING_UPDATED",
        "STOCK",
        {
          reviewedCount: phase7ReinforcementLearningState.reviewedCount,
          trustedSetupCount: phase7ReinforcementLearningState.trustedSetupCount,
          suppressedSetupCount: phase7ReinforcementLearningState.suppressedSetupCount,
          averageSetupTrust: phase7ReinforcementLearningState.averageSetupTrust,
        }
      );
      for (const signal of results) {
        const phase9LiquidityIntelligence =
          calculatePhase9LiquidityIntelligence(signal);
        signal.phase9LiquidityIntelligence = phase9LiquidityIntelligence;
        signal.liquidityScore = phase9LiquidityIntelligence.liquidityScore;
        signal.liquidityLabel = phase9LiquidityIntelligence.liquidityLabel;
        if (Number(phase9LiquidityIntelligence.scoreBoost || 0) !== 0) {
          signal.score = clampScore(
            Number(signal.score || 0) +
            Number(phase9LiquidityIntelligence.scoreBoost || 0)
          );
        }
        if (
          phase9LiquidityIntelligence.liquidityLabel === "WEAK_LIQUIDITY_TRAP" &&
          Number(signal.score || 0) < 82
        ) {
          signal.qualifiedToBuy = false;
          signal.phase9LiquiditySuppressed = true;
          signal.phase9SuppressionReason =
            phase9LiquidityIntelligence.reason;
        }
      }
      const phase9LiquidityIntelligenceState =
        updatePhase9LiquidityIntelligenceState(results);
      recordOrder("PHASE_9_LIQUIDITY_INTELLIGENCE_UPDATED", "STOCK", {
        reviewedCount: phase9LiquidityIntelligenceState.reviewedCount,
        strongLiquidityCount:
          phase9LiquidityIntelligenceState.strongLiquidityCount,
        weakLiquidityCount:
          phase9LiquidityIntelligenceState.weakLiquidityCount,
        averageLiquidityScore:
          phase9LiquidityIntelligenceState.averageLiquidityScore,
      });
      for (const signal of results) {
        const phase10RunnerMemory =
          calculatePhase10RunnerFingerprint(signal);
        signal.phase10RunnerMemory = phase10RunnerMemory;
        signal.continuationProbability =
          phase10RunnerMemory.continuationProbability;
        signal.breakoutSimilarityScore =
          phase10RunnerMemory.breakoutSimilarityScore;
        signal.runnerFingerprintScore =
          phase10RunnerMemory.runnerFingerprintScore;
        signal.runnerType =
          phase10RunnerMemory.runnerType;
        const multiDayProbability =
          calculateMultiDayProbability(signal);
        signal.multiDayProbability =
          multiDayProbability.multiDayProbability;
        signal.multiDayScore =
          multiDayProbability.multiDayScore;
        signal.multiDayLabel =
          multiDayProbability.multiDayLabel;
        signal.multiDayContinuation =
          multiDayProbability;
        if (Number(phase10RunnerMemory.scoreBoost || 0) !== 0) {
          signal.score = clampScore(
            Number(signal.score || 0) +
            Number(phase10RunnerMemory.scoreBoost || 0)
          );
        }
      }
      const phase10RunnerMemoryState =
        updatePhase10RunnerMemoryState(results);
      recordOrder("PHASE_10_RUNNER_MEMORY_UPDATED", "STOCK", {
        reviewedCount: phase10RunnerMemoryState.reviewedCount,
        eliteRunnerCount:
          phase10RunnerMemoryState.eliteRunnerCount,
        explosiveRunnerCount:
          phase10RunnerMemoryState.explosiveRunnerCount,
      });
      for (const signal of results) {
        const phase11MetaStrategy =
          calculatePhase11MetaStrategyMutation(signal);
        signal.phase11MetaStrategy = phase11MetaStrategy;
        signal.metaStrategyPreference =
          phase11MetaStrategy.strategyPreference;
        signal.metaAggressionScore =
          phase11MetaStrategy.aggressionScore;
        if (Number(phase11MetaStrategy.scoreAdjustment || 0) !== 0) {
          signal.score = clampScore(
            Number(signal.score || 0) +
            Number(phase11MetaStrategy.scoreAdjustment || 0)
          );
        }
        if (phase11MetaStrategy.suppressByMetaStrategy) {
          signal.qualifiedToBuy = false;
          signal.phase11Suppressed = true;
          signal.phase11SuppressionReason =
            phase11MetaStrategy.reason;
        }
      }
      const phase11MetaStrategyState =
        updatePhase11MetaStrategyState(results);
      recordOrder("PHASE_11_META_STRATEGY_UPDATED", "STOCK", {
        reviewedCount: phase11MetaStrategyState.reviewedCount,
        aggressiveSetupCount:
          phase11MetaStrategyState.aggressiveSetupCount,
        suppressedSetupCount:
          phase11MetaStrategyState.suppressedSetupCount,
      });
      for (const signal of results) {
        const phase12MacroCorrelation =
          calculatePhase12MacroCorrelationSignal(signal);
        signal.phase12MacroCorrelation = phase12MacroCorrelation;
        signal.macroCorrelationScore =
          phase12MacroCorrelation.macroCorrelationScore;
        signal.macroPressureScore =
          phase12MacroCorrelation.macroPressureScore;
        signal.sectorContagionRisk =
          phase12MacroCorrelation.sectorContagionRisk;
        if (Number(phase12MacroCorrelation.scoreAdjustment || 0) !== 0) {
          signal.score = clampScore(
            Number(signal.score || 0) +
            Number(phase12MacroCorrelation.scoreAdjustment || 0)
          );
        }
        if (phase12MacroCorrelation.suppressByMacroCorrelation) {
          signal.qualifiedToBuy = false;
          signal.phase12Suppressed = true;
          signal.phase12SuppressionReason =
            phase12MacroCorrelation.reason;
        }
      }
      const phase12MacroCorrelationState =
        updatePhase12MacroCorrelationState(results);
      recordOrder("PHASE_12_MACRO_CORRELATION_UPDATED", "MARKET", {
        reviewedCount: phase12MacroCorrelationState.reviewedCount,
        macroStressScore: phase12MacroCorrelationState.macroStressScore,
        hiddenExposureRiskScore:
          phase12MacroCorrelationState.hiddenExposureRiskScore,
        shouldReduceExposure:
          phase12MacroCorrelationState.shouldReduceExposure,
      });
      for (const signal of results) {
        const phase13HedgeFundBrain =
          calculatePhase13HedgeFundBrain(signal);
        signal.phase13HedgeFundBrain = phase13HedgeFundBrain;
        signal.hedgeFundConvictionScore =
          phase13HedgeFundBrain.hedgeFundConvictionScore;
        signal.hedgeFundCapitalDecision =
          phase13HedgeFundBrain.capitalDecision;
        if (Number(phase13HedgeFundBrain.scoreAdjustment || 0) !== 0) {
          signal.score = clampScore(
            Number(signal.score || 0) +
            Number(phase13HedgeFundBrain.scoreAdjustment || 0)
          );
        }
        if (phase13HedgeFundBrain.suppressByHedgeFundBrain) {
          signal.qualifiedToBuy = false;
          signal.phase13Suppressed = true;
          signal.phase13SuppressionReason =
            phase13HedgeFundBrain.reason;
        }
      }
      const phase13HedgeFundBrainState =
        updatePhase13HedgeFundBrainState(results);
      recordOrder("PHASE_13_HEDGE_FUND_BRAIN_UPDATED", "BRAIN", {
        reviewedCount: phase13HedgeFundBrainState.reviewedCount,
        deployableCount: phase13HedgeFundBrainState.deployableCount,
        blockedCount: phase13HedgeFundBrainState.blockedCount,
      });
      for (const signal of results) {
        const phase14Governor =
          calculatePhase14ProfitAccelerationGovernor(signal);
        signal.phase14Governor = phase14Governor;
        signal.governorApprovalScore =
          phase14Governor.governorApprovalScore;
        signal.eliteConsensus =
          phase14Governor.eliteConsensus;
        if (phase14Governor.suppressByGovernor) {
          signal.qualifiedToBuy = false;
          signal.phase14Suppressed = true;
          signal.phase14SuppressionReason =
            phase14Governor.reason;
        }
      }
      const phase14GovernorState =
        updatePhase14GovernorState(results);
      recordOrder("PHASE_14_GOVERNOR_UPDATED", "GOVERNOR", {
        reviewedCount: phase14GovernorState.reviewedCount,
        eliteConsensusCount:
          phase14GovernorState.eliteConsensusCount,
        blockedCount:
          phase14GovernorState.blockedCount,
      });
      for (const signal of results) {
        const finalGrade =
          calculateInstitutionalGrade(signal);
        signal.finalInstitutionalGrade =
          finalGrade.finalInstitutionalGrade;
        signal.finalInstitutionalGradeLabel =
          finalGrade.finalInstitutionalGradeLabel;
        signal.finalInstitutionalEliteScore =
          finalGrade.eliteScore;
        signal.finalInstitutionalPassedChecks =
          finalGrade.passedChecks;
        signal.finalInstitutionalFailedChecks =
          finalGrade.failedChecks;
        signal.finalInstitutionalGradeMultiplier =
          finalGrade.gradeMultiplier;
        signal.finalInstitutionalGradeChecks =
          finalGrade.gradeChecks;
        signal.finalInstitutionalRawGradeInputs =
          finalGrade.rawGradeInputs;
        signal.finalInstitutionalGradeReason =
          finalGrade.reason;
      }
      const finalResults = results;
      return finalResults
        .sort((a, b) => {
          const rankA =
            Number(a.score || 0) * 0.35 +
            Number(a.explosiveRunnerScore || a.runnerScore || 0) * 0.30 +
            Number(a.earlyProjectionScore || 0) * 0.20 +
            Number(a.aiConfidence || a.autonomousConfidenceScore || 0) * 0.15;
          const rankB =
            Number(b.score || 0) * 0.35 +
            Number(b.explosiveRunnerScore || b.runnerScore || 0) * 0.30 +
            Number(b.earlyProjectionScore || 0) * 0.20 +
            Number(b.aiConfidence || b.autonomousConfidenceScore || 0) * 0.15;
          if (rankB !== rankA) return rankB - rankA;
          return Number(b.percentChange || 0) - Number(a.percentChange || 0);
        })
        .slice(0, CONFIG.maxSignalsToReturn);
    } finally {
      activeScanLocks.scanMarket = false;
    }
  }

  return { calculateInstitutionalScores, passesFilters, scoreStock, scanMarket };
}
