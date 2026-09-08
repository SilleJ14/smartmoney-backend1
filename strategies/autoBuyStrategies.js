import {
  CRYPTO_MAX_ENTRY_SPREAD_PERCENT,
} from "../scoring/cryptoScoring.js";
import {
  CRYPTO_MIN_FINAL_SCORE_TO_BUY,
  evaluateCryptoTradeCandidate,
} from "../scoring/componentScore.js";
import { evaluateStockTradeCandidate } from "../scoring/decisionScores.js";
import {
  getCanonicalFinalScore,
  hasExplicitTradeApproval,
} from "../scoring/canonicalSignalRank.js";

export function resolveCanonicalStockDecisionScore(signal = {}) {
  const value = getCanonicalFinalScore({ ...signal, assetClass: "stock" });
  return value === null ? 0 : value;
}

export function evaluateCanonicalStockAutoBuyEligibility(
  signal = {},
  minimumScore = 78,
  options = {}
) {
  const evidence = evaluateStockTradeCandidate(signal, {
    ...options,
    requireCentralDecision: true,
    requireFreshDecision: true,
    requireExplicitApproval: true,
  });
  const canonicalScore = resolveCanonicalStockDecisionScore(signal);
  return {
    approved: evidence.approved && canonicalScore >= Number(minimumScore || 0),
    canonicalScore,
    minimumScore: Number(minimumScore || 0),
    evidence,
  };
}

export function createAutoBuyStrategies(dependencies) {
  const {
    CONFIG,
    calculateAdaptiveAggressionRebalancer,
    calculateAdaptiveCryptoPositionSize,
    calculateAdaptiveSuppressionBalancer,
    calculateAiPortfolioManagerDecision,
    calculateAutonomousCapitalPressure,
    calculateEliteMomentumExceptionGate,
    calculateEliteRunnerHeatOverride,
    calculateFinalMasterDecisionProfile,
    calculateInstitutionalEntryTiming,
    calculateInstitutionalExecutionPlan,
    calculateLiquiditySweepTrapDetection,
    calculateMorningStrikeOverrideGate,
    calculatePhase10RunnerFingerprint,
    calculatePhase11MetaStrategyMutation,
    calculatePhase12MacroCorrelationSignal,
    calculatePhase13HedgeFundBrain,
    calculatePhase14FinalInstitutionalNormalization,
    calculatePhase14ProfitAccelerationGovernor,
    calculatePhase15AutonomousExecutionDominance,
    calculatePhase16InstitutionalPortfolioParliament,
    calculatePhase20FinalMasterExecutionGate,
    calculatePhase34AdaptiveAggressionBalancer,
    calculatePhase35AiGovernanceLayer,
    calculatePhase36PredictiveExecutionTiming,
    calculatePhase37SelfBalancingAiEcosystem,
    calculatePhase38AutonomousCapitalParliament,
    calculatePhase39MetaStrategyAi,
    calculatePhase40RecursiveRealTimeLearning,
    calculatePhase41InstitutionalCompressionIntelligence,
    calculatePhase7ReinforcementLearning,
    calculatePhase9LiquidityIntelligence,
    calculateSetupRecognitionScore,
    canTakeMoreMorningTrades,
    clampScore,
    classifyInstitutionalSetup,
    detectMarketRegime,
    engineState,
    executeAdaptiveBuyOrder,
    getAccount,
    getBotExposure,
    getBotOwnedSymbols,
    getClock,
    getCryptoAvailableBuyingPower,
    getDynamicTradeAmount,
    getEffectiveBuyThreshold,
    getPositions,
    getReinforcementLearnedMultiplier,
    isAiManagedOpenPosition,
    isCrypto,
    isMorningStrikeWindow,
    journalTradeEntry,
    markAiManagedSymbol,
    markMorningTradeUsed,
    normalizeSymbol,
    passesAutonomousParliamentGate,
    passesInstitutionalOrchestratorBuyGate,
    recordFailedOrder,
    recordOrder,
    replaceWeakestIfBetter,
    resetDailyMorningTradeCounter,
    rotateWeakCryptoIfBetter,
    shouldSkipFromTradeMemory,
    getTradingMode,
  } = dependencies;

  function getCryptoDecisionScore(signal = {}) {
    const value = getCanonicalFinalScore({ ...signal, assetClass: "crypto" });
    return value === null ? 0 : value;
  }

  function getMeasuredCryptoSpread(signal = {}) {
    const bid = Number(signal.bid);
    const ask = Number(signal.ask);
    const providedSpread = signal.spreadPercent === null || signal.spreadPercent === undefined
      ? undefined
      : Number(signal.spreadPercent);
    const quoteMeasured =
      Number.isFinite(bid) &&
      Number.isFinite(ask) &&
      bid > 0 &&
      ask >= bid;
    if (quoteMeasured) {
      const measured = ((ask - bid) / ((ask + bid) / 2)) * 100;
      return measured >= 0 ? measured : null;
    }
    if (signal.cryptoRealism?.spreadAvailable === false || signal.spreadAvailable === false) {
      return null;
    }
    if (
      (signal.cryptoRealism?.spreadAvailable === true || signal.spreadAvailable === true) &&
      Number.isFinite(providedSpread) &&
      providedSpread >= 0
    ) {
      return providedSpread;
    }
    return null;
  }

  function hasCompleteCryptoEntryEvidence(signal = {}) {
    return evaluateCryptoTradeCandidate(signal, { minimumScore: 0 }).approved;
  }

  async function autoBuySignals(signals = []) {
    const TRADING_MODE = getTradingMode();
    if (!["live_stock", "smart"].includes(TRADING_MODE)) return;
    resetDailyMorningTradeCounter();
    if (!canTakeMoreMorningTrades()) {
      recordOrder("AUTO_STOCK_BUY_SKIPPED_DAILY_LIMIT", "STOCK", {
        morningTradesToday: engineState.morningTradesToday,
        maxMorningTradesPerDay: CONFIG.maxMorningTradesPerDay,
      });
      return;
    }
    const clock = await getClock();
    const allowClosedMarketStockBuying = false;
    if (!clock.is_open && !allowClosedMarketStockBuying) {
      recordOrder("AUTO_STOCK_BUY_SKIPPED", "STOCK", {
        reason: "Market closed",
      });
      return;
    }
    if (!clock.is_open && allowClosedMarketStockBuying) {
      recordOrder("AUTO_STOCK_AFTER_HOURS_ALLOWED", "STOCK", {
        reason: "Temporary override: stock buying allowed while market is closed",
      });
    }
    const account = await getAccount();
    const positions = await getPositions();
    const aiOwnedSymbols = await getBotOwnedSymbols();
    const aiPositions = positions.filter((position) => {
      const symbol = normalizeSymbol(position.symbol);
      return (
        aiOwnedSymbols.has(symbol) ||
        engineState.aiManagedSymbols?.includes(symbol)
      );
    });
    const aiStockPositions = aiPositions.filter((position) => {
      const symbol = normalizeSymbol(position.symbol);
      return (
        !symbol.includes("/") &&
        position.asset_class !== "crypto"
      );
    });
    const managedPositions = aiPositions;
    const maxBotBudget =
      Number(account.equity || 0) *
      (Number(CONFIG.maxBotExposurePercent || 0) / 100);
    const currentBotExposure = getBotExposure(aiPositions);
    const remainingBotBudget = Math.max(
      0,
      maxBotBudget - currentBotExposure
    );
    if (remainingBotBudget <= 0) {
      if (CONFIG.enableWeakestReplacement) {
        const rotated = await replaceWeakestIfBetter(
          signals,
          positions,
          aiOwnedSymbols
        );
        if (rotated) {
          return;
        }
      }
      recordOrder("AUTO_STOCK_BUY_SKIPPED_EXPOSURE_FULL", "STOCK", {
        reason: "Max bot exposure reached",
        maxBotExposurePercent: CONFIG.maxBotExposurePercent,
        maxBotBudget: Number(maxBotBudget.toFixed(2)),
        currentBotExposure: Number(currentBotExposure.toFixed(2)),
        remainingBotBudget: Number(remainingBotBudget.toFixed(2)),
        openStockPositions: aiStockPositions.length,
        totalAiPositions: aiPositions.length,
      });
      return;
    }
    const openSlots = Math.min(
      CONFIG.maxOpenTrades - aiPositions.length,
      CONFIG.maxStockOpenTrades - aiStockPositions.length
    );
    if (openSlots <= 0) {
      if (CONFIG.enableWeakestReplacement) {
        const rotated = await replaceWeakestIfBetter(
          signals,
          positions,
          aiOwnedSymbols
        );
        if (rotated) {
          return;
        }
      }
      recordOrder("AUTO_STOCK_BUY_SKIPPED", "STOCK", {
        reason: "Max stock or total AI positions reached",
        stockOpen: aiStockPositions.length,
        totalOpen: aiPositions.length,
        maxStockOpenTrades: CONFIG.maxStockOpenTrades,
        maxOpenTrades: CONFIG.maxOpenTrades,
      });
      return;
    }
    const frozenOpenSlots = openSlots;
    const effectiveBuyThreshold = getEffectiveBuyThreshold(signals);
    const adaptiveMinScoreToBuy = Math.max(
      78,
      effectiveBuyThreshold,
      Number(CONFIG.minScoreToBuy || 70),
      Number(engineState.selfOptimizationState?.adaptiveMinScoreToBuy || 0)
    );
    engineState.effectiveBuyThreshold = {
      updatedAt: new Date().toISOString(),
      hardFloor: 78,
      configMinScoreToBuy: CONFIG.minScoreToBuy,
      effectiveBuyScore: adaptiveMinScoreToBuy,
      reason:
        adaptiveMinScoreToBuy > 78
          ? "Buy threshold raised above 78 by risk/adaptive conditions."
          : "Stock hard floor active. Buy threshold cannot go below 78.",
    };
    const frozenApprovedSignals = signals
      .filter(
        (signal) => {
          const eligibility = evaluateCanonicalStockAutoBuyEligibility(
            signal,
            adaptiveMinScoreToBuy
          );
          return eligibility.approved;
        }
      )
      .sort(
        (a, b) =>
          resolveCanonicalStockDecisionScore(b) -
          resolveCanonicalStockDecisionScore(a)
      )
      .slice(
        0,
        Math.max(
          frozenOpenSlots * 5,
          Number(CONFIG.topAutoTradeCandidates || 15)
        )
      );
    const executableSymbols = new Set(
      (
        engineState.executionIntelligenceState?.topExecutableSignals || []
      ).map((signal) => normalizeSymbol(signal.symbol))
    );
    const baseCandidates = frozenApprovedSignals
      .filter((signal) => {
        const symbol = normalizeSymbol(signal.symbol);
        const score = resolveCanonicalStockDecisionScore(signal);
        const adaptiveMinScore = Number(
          engineState.selfOptimizationState?.adaptiveMinScoreToBuy ||
          CONFIG.minScoreToBuy
        );
        const executionApproved = executableSymbols.has(symbol);
        const normalQualified = evaluateCanonicalStockAutoBuyEligibility(
          signal,
          0
        ).approved;
        return (
          normalQualified ||
          (
            executionApproved &&
            score >= adaptiveMinScore &&
            signal.confirmations?.fakeBreakout !== true &&
            engineState.phase21AutonomousBrainState?.shouldBlockNewTrades !== true &&
            engineState.phase20AutonomousOrchestrationState?.shouldBlockNewTrades !== true
          )
        );
      })
      .filter((signal) => resolveCanonicalStockDecisionScore(signal) >= adaptiveMinScoreToBuy)
      .filter((signal) => {
        const symbol = normalizeSymbol(signal.symbol);
        const lastSold = engineState.lastSoldAt[symbol] || 0;
        return (
          !aiOwnedSymbols.has(symbol) &&
          !positions.some((p) => normalizeSymbol(p.symbol) === symbol) &&
          Date.now() - lastSold > 120000
        );
      })
      .filter((signal) => {
        // FIX8: deepIntelligenceBias gate — block RISKY signals
        const bias = signal.deepIntelligenceBias ||
          signal.deepIntelligence?.deepIntelligenceBias || "";
        if (bias === "RISKY") {
          recordOrder("STOCK_SKIPPED_DEEP_INTEL_RISKY", normalizeSymbol(signal.symbol), {
            deepIntelligenceScore: signal.deepIntelligenceScore,
            bias,
          });
          return false;
        }
        return true;
      });
    const morningStrikeSymbols = new Set(
      (
        engineState.premarketMomentumState?.eliteCandidates || []
      ).map((signal) => normalizeSymbol(signal.symbol))
    );
    const morningStrikeCandidates = baseCandidates
      .filter((signal) =>
        morningStrikeSymbols.has(normalizeSymbol(signal.symbol))
      )
      .sort(
        (a, b) =>
          Number(b.morningMomentumScore || b.premarketMomentum?.morningMomentumScore || resolveCanonicalStockDecisionScore(b)) -
          Number(a.morningMomentumScore || a.premarketMomentum?.morningMomentumScore || resolveCanonicalStockDecisionScore(a))
      )
      .slice(0, Math.min(openSlots, Number(CONFIG.eliteMorningStrikeLimit || 10)));
    const fallbackCandidates = baseCandidates
      .filter(
        (signal) =>
          !morningStrikeSymbols.has(normalizeSymbol(signal.symbol))
      )
      .sort((a, b) => resolveCanonicalStockDecisionScore(b) - resolveCanonicalStockDecisionScore(a))
      .slice(0, Math.max(0, openSlots - morningStrikeCandidates.length));
    const remainingMorningTrades = Math.max(
      0,
      Number(CONFIG.maxMorningTradesPerDay || 10) -
      Number(engineState.morningTradesToday || 0)
    );
    const effectiveOpenSlots = Math.min(
      openSlots,
      remainingMorningTrades
    );
    const candidates = [
      ...morningStrikeCandidates,
      ...fallbackCandidates,
    ].slice(0, effectiveOpenSlots);
    engineState.morningStrikeState = {
      updatedAt: new Date().toISOString(),
      phase: "16.3_TOP_TWO_MORNING_STRIKE_SELECTOR",
      isMorningStrikeWindow: isMorningStrikeWindow(),
      openSlots,
      baseCandidateCount: baseCandidates.length,
      morningStrikeCandidateCount: morningStrikeCandidates.length,
      fallbackCandidateCount: fallbackCandidates.length,
      selectedSymbols: candidates.map((signal) => signal.symbol),
      topMorningStrikeSymbols: Array.from(morningStrikeSymbols).slice(0, 5),
      reason:
        `${morningStrikeCandidates.length} from elite morning strike list`,
    };
    engineState.morningStrikeHistory.unshift(engineState.morningStrikeState);
    engineState.morningStrikeHistory =
      engineState.morningStrikeHistory.slice(0, 200);
    let successfulStockBuysThisCycle = 0;
    let stockBudgetReservedThisCycle = 0;
    for (const candidate of candidates) {
      const symbol = normalizeSymbol(candidate.symbol);
      const stockTradeEvidence = evaluateStockTradeCandidate(candidate, {
        requireCentralDecision: true,
        requireFreshDecision: true,
        requireExplicitApproval: true,
      });
      if (!stockTradeEvidence.approved) {
        recordOrder("STOCK_SKIPPED_ENTRY_EVIDENCE", symbol, {
          ...stockTradeEvidence,
        });
        continue;
      }
      candidate.legacySignalScore = Number(candidate.score || 0);
      candidate.score = resolveCanonicalStockDecisionScore(candidate);
      candidate.scoreSource = "canonical_stock_final_decision";
      if (shouldSkipFromTradeMemory(symbol)) {
        recordOrder("STOCK_SKIPPED_TRADE_MEMORY", symbol, {
          memory: engineState.tradeMemory?.[symbol],
        });
        continue;
      }
      const orchestratorGate =
        passesInstitutionalOrchestratorBuyGate(candidate);
      if (!orchestratorGate.allowed) {
        recordOrder("STOCK_SKIPPED_ORCHESTRATOR", symbol, {
          reason: orchestratorGate.reason,
        });
        continue;
      }
      let parliamentGate =
        passesAutonomousParliamentGate(candidate);
      const morningStrikeOverrideGate =
        calculateMorningStrikeOverrideGate(
          candidate,
          new Set([
            ...Array.from(aiOwnedSymbols || []),
            ...positions.map((p) => normalizeSymbol(p.symbol)),
          ])
        );
      const eliteMomentumExceptionGate =
        calculateEliteMomentumExceptionGate(
          candidate,
          new Set([
            ...Array.from(aiOwnedSymbols || []),
            ...positions.map((p) => normalizeSymbol(p.symbol)),
          ])
        );
      if (!parliamentGate.allowed && morningStrikeOverrideGate.allowed) {
        parliamentGate = {
          allowed: true,
          multiplier: morningStrikeOverrideGate.multiplier,
          reason: morningStrikeOverrideGate.reason,
          morningStrikeOverride: morningStrikeOverrideGate,
        };
        recordOrder("MORNING_STRIKE_OVERRIDE_APPROVED", symbol, {
          reason: morningStrikeOverrideGate.reason,
          premarket: morningStrikeOverrideGate.premarket,
        });
      }
      if (
        !parliamentGate.allowed &&
        !morningStrikeOverrideGate.allowed &&
        eliteMomentumExceptionGate.allowed
      ) {
        parliamentGate = {
          allowed: true,
          multiplier: eliteMomentumExceptionGate.multiplier,
          reason: eliteMomentumExceptionGate.reason,
          eliteMomentumException: eliteMomentumExceptionGate,
        };
        recordOrder("ELITE_MOMENTUM_EXCEPTION_APPROVED", symbol, {
          reason: eliteMomentumExceptionGate.reason,
          checks: eliteMomentumExceptionGate.checks,
          premarket: eliteMomentumExceptionGate.premarket,
        });
      }
      if (!parliamentGate.allowed) {
        recordOrder("STOCK_SKIPPED_PARLIAMENT", symbol, {
          reason: parliamentGate.reason,
        });
        continue;
      }
      const provisionalTradeAmount =
        getDynamicTradeAmount(account, aiPositions, candidate.score);
      const institutionalExecutionPlan =
        calculateInstitutionalExecutionPlan(
          candidate,
          provisionalTradeAmount
        );
      candidate.institutionalExecutionPlan =
        institutionalExecutionPlan;
      candidate.executionConfidence =
        institutionalExecutionPlan.executionConfidence;
      candidate.runnerScore =
        Number(
          candidate.explosiveRunnerScore ||
          candidate.explosiveRunnerPrediction
            ?.explosiveRunnerScore ||
          candidate.adaptiveRunnerScore ||
          0
        );
      candidate.premarketDominanceScore =
        Number(
          candidate.premarketDominance
            ?.premarketDominanceScore ||
          candidate.explosiveRunnerPrediction
            ?.premarket
            ?.openingDriveProbability ||
          candidate.explosiveRunnerPrediction
            ?.premarket
            ?.morningMomentumScore ||
          candidate.premarketDominanceScore ||
          0
        );
      candidate.institutionalBrainScore =
        Number(
          candidate.fullInstitutionalAiBrain
            ?.consensusScore ||
          candidate.fullInstitutionalAiBrain
            ?.dynamicConvictionScore ||
          candidate.institutionalBrainScore ||
          50
        );
      const portfolioManager =
        typeof calculateAiPortfolioManagerDecision === "function"
          ? calculateAiPortfolioManagerDecision(
            candidate,
            account,
            aiPositions,
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
      const baseTradeAmount =
        Number(portfolioManager.recommendedTradeAmount || 0) ||
        provisionalTradeAmount;
      if (
        institutionalExecutionPlan.executionMode ===
        "AVOID_WEAK_EXECUTION"
      ) {
        recordOrder(
          "AUTO_STOCK_BUY_SKIPPED_WEAK_EXECUTION",
          symbol,
          {
            institutionalExecutionPlan,
            candidateScore: candidate.score,
          }
        );
        continue;
      }
      const institutionalGrade = String(
        candidate.institutionalEntryGrade ||
        candidate.technicalIntelligence?.institutionalEntryGrade ||
        ""
      );
      const hasStrongEnoughGrade =
        institutionalGrade.includes("A") ||
        institutionalGrade.includes("B") ||
        Number(candidate.technicalScore || 0) >= 65;
      const eliteRecognition =
        calculateSetupRecognitionScore(candidate);
      candidate.eliteSetupRecognition = eliteRecognition;
      candidate.eliteRecognitionScore =
        eliteRecognition.eliteRecognitionScore;
      candidate.eliteRecognitionTier =
        eliteRecognition.eliteRecognitionTier;
      const eliteCapitalBoost =
        eliteRecognition.eliteRecognitionTier === "S_TIER_ELITE" &&
          hasStrongEnoughGrade &&
          Number(candidate.breakoutProbability || 0) >= 88 &&
          Number(candidate.continuationProbability || 0) >= 85 &&
          candidate.confirmations?.aboveVwap === true &&
          Number(candidate.confirmations?.pullbackFromHighPercent || 0) <= 1.5 &&
          Number(institutionalExecutionPlan.executionConfidence || 0) >= 82 &&
          candidate.confirmations?.fakeBreakout !== true
          ? 3.2
          : eliteRecognition.eliteRecognitionTier === "A_TIER_ELITE" &&
            hasStrongEnoughGrade &&
            Number(candidate.breakoutProbability || 0) >= 80 &&
            Number(candidate.continuationProbability || 0) >= 75 &&
            candidate.confirmations?.aboveVwap === true &&
            Number(candidate.confirmations?.pullbackFromHighPercent || 0) <= 2 &&
            Number(institutionalExecutionPlan.executionConfidence || 0) >= 70 &&
            candidate.confirmations?.fakeBreakout !== true
            ? 2.2
            : eliteRecognition.eliteRecognitionTier === "HIGH_QUALITY" &&
              hasStrongEnoughGrade &&
              Number(candidate.breakoutProbability || 0) >= 72 &&
              Number(candidate.continuationProbability || 0) >= 68 &&
              candidate.confirmations?.aboveVwap === true &&
              candidate.confirmations?.fakeBreakout !== true
              ? 1.45
              : 0.85;
      const executionAdjustedBaseTradeAmount =
        Number(
          (
            Number(baseTradeAmount || 0) *
            Number(
              institutionalExecutionPlan.executionSizeMultiplier || 1
            ) *
            eliteCapitalBoost
          ).toFixed(2)
        );
      const entryTiming =
        calculateInstitutionalEntryTiming({
          ...candidate,
          institutionalExecutionPlan,
        });
      candidate.entryTiming = entryTiming;
      if (entryTiming.entryMode === "WAIT_FOR_BETTER_ENTRY") {
        recordOrder("AUTO_STOCK_BUY_SKIPPED_ENTRY_TIMING", symbol, {
          score: candidate.score,
          entryTiming,
          reason: "Entry timing engine says wait for better entry.",
        });
        continue;
      }
      const eliteRunnerHeatOverride =
        calculateEliteRunnerHeatOverride(candidate);
      candidate.eliteRunnerHeatOverride =
        eliteRunnerHeatOverride;
      const adaptiveAggression =
        calculateAdaptiveAggressionRebalancer(candidate);
      candidate.adaptiveAggression =
        adaptiveAggression;
      const liquiditySweepTrap =
        calculateLiquiditySweepTrapDetection({
          ...candidate,
          institutionalExecutionPlan,
        });
      candidate.liquiditySweepTrap = liquiditySweepTrap;
      if (liquiditySweepTrap.shouldRejectEntry) {
        recordOrder("AUTO_STOCK_BUY_SKIPPED_LIQUIDITY_TRAP", symbol, {
          score: candidate.score,
          liquiditySweepTrap,
          reason: "Liquidity sweep/trap engine rejected entry.",
        });
        continue;
      }
      const autonomousConfidenceScore = clampScore(
        Number(candidate.score || 0) * 0.22 +
        Number(candidate.institutionalBrainScore || 0) * 0.2 +
        Number(candidate.statisticalScore || 0) * 0.16 +
        Number(
          candidate.explosiveRunnerScore ||
          candidate.explosiveRunnerPrediction?.explosiveRunnerScore ||
          candidate.adaptiveRunnerScore ||
          0
        ) * 0.18 +
        Number(
          candidate.premarketDominance?.premarketDominanceScore ||
          candidate.premarketDominanceScore ||
          0
        ) * 0.14 +
        Number(
          institutionalExecutionPlan.executionConfidence || 0
        ) * 0.1
      );
      const autonomousConfidenceMultiplier =
        autonomousConfidenceScore >= 85
          ? 1.25
          : autonomousConfidenceScore >= 75
            ? 1.12
            : autonomousConfidenceScore >= 65
              ? 1
              : 0.82;
      const regimeProtectionMultiplier =
        Number(engineState.marketStressLevel || 0) >= 75
          ? 0.75
          : Number(engineState.marketStressLevel || 0) >= 60
            ? 0.85
            : 1;
      const reinforcementSizing =
        getReinforcementLearnedMultiplier(
          autonomousConfidenceScore
        );
      const phase7Reinforcement =
        candidate.phase7Reinforcement ||
        calculatePhase7ReinforcementLearning(candidate);
      if (phase7Reinforcement.suppressEntry) {
        recordOrder("AUTO_STOCK_BUY_SKIPPED_PHASE_7_SUPPRESSION", symbol, {
          score: candidate.score,
          phase7Reinforcement,
          reason:
            "Phase 7 learned this setup is low-trust and suppressed the entry.",
        });
        continue;
      }
      const phase7SizingMultiplier =
        Number(phase7Reinforcement.learnedSizingMultiplier || 1);
      const phase9LiquidityIntelligence =
        candidate.phase9LiquidityIntelligence ||
        calculatePhase9LiquidityIntelligence(candidate);
      candidate.phase9LiquidityIntelligence =
        phase9LiquidityIntelligence;
      if (
        phase9LiquidityIntelligence.liquidityLabel === "WEAK_LIQUIDITY_TRAP" &&
        Number(candidate.score || 0) < 82
      ) {
        recordOrder(
          "AUTO_STOCK_BUY_SKIPPED_PHASE_9_WEAK_LIQUIDITY",
          symbol,
          {
            score: candidate.score,
            phase9LiquidityIntelligence,
            reason:
              "Phase 9 blocked entry because liquidity quality is weak.",
          }
        );
        continue;
      }
      const phase10RunnerMemory =
        candidate.phase10RunnerMemory ||
        calculatePhase10RunnerFingerprint(candidate);
      const phase11MetaStrategy =
        candidate.phase11MetaStrategy ||
        calculatePhase11MetaStrategyMutation(candidate);
      const phase12MacroCorrelation =
        candidate.phase12MacroCorrelation ||
        calculatePhase12MacroCorrelationSignal(candidate);
      const phase13HedgeFundBrain =
        candidate.phase13HedgeFundBrain ||
        calculatePhase13HedgeFundBrain(candidate);
      const phase14Governor =
        candidate.phase14Governor ||
        calculatePhase14ProfitAccelerationGovernor(candidate);
      const phase15ExecutionDominance =
        candidate.phase15ExecutionDominance ||
        calculatePhase15AutonomousExecutionDominance(
          candidate,
          executionAdjustedBaseTradeAmount
        );
      if (phase15ExecutionDominance.blockExecution) {
        recordOrder(
          "AUTO_STOCK_BUY_SKIPPED_PHASE_15_EXECUTION",
          symbol,
          {
            score: candidate.score,
            phase15ExecutionDominance,
            reason:
              "Phase 15 blocked entry because execution quality is too weak.",
          }
        );
        continue;
      }
      if (phase14Governor.suppressByGovernor) {
        recordOrder(
          "AUTO_STOCK_BUY_SKIPPED_PHASE_14_GOVERNOR",
          symbol,
          {
            score: candidate.score,
            phase14Governor,
            reason:
              "Phase 14 governor blocked aggressive deployment.",
          }
        );
        continue;
      }
      if (phase13HedgeFundBrain.suppressByHedgeFundBrain) {
        recordOrder("AUTO_STOCK_BUY_SKIPPED_PHASE_13_HEDGE_FUND_BRAIN", symbol, {
          score: candidate.score,
          phase13HedgeFundBrain,
          reason:
            "Phase 13 blocked entry because hedge-fund brain rejected deployment.",
        });
        continue;
      }
      if (phase12MacroCorrelation.suppressByMacroCorrelation) {
        recordOrder("AUTO_STOCK_BUY_SKIPPED_PHASE_12_MACRO_CORRELATION", symbol, {
          score: candidate.score,
          phase12MacroCorrelation,
          reason:
            "Phase 12 blocked entry because macro/correlation risk is too high.",
        });
        continue;
      }
      if (phase11MetaStrategy.suppressByMetaStrategy) {
        recordOrder("AUTO_STOCK_BUY_SKIPPED_PHASE_11_META_STRATEGY", symbol, {
          score: candidate.score,
          phase11MetaStrategy,
          reason:
            "Phase 11 blocked entry because meta-strategy aggression is too weak.",
        });
        continue;
      }
      const phase9LiquiditySizingMultiplier =
        phase9LiquidityIntelligence.liquidityScore >= 82
          ? 1.12
          : phase9LiquidityIntelligence.liquidityScore >= 70
            ? 1.06
            : phase9LiquidityIntelligence.liquidityScore <= 40
              ? 0.8
              : 1;
      const phase11MetaStrategySizingMultiplier =
        Number(phase11MetaStrategy.metaStrategyMultiplier || 1);
      const phase12MacroSizingMultiplier =
        Number(phase12MacroCorrelation.macroSizingMultiplier || 1);
      const phase13HedgeFundSizingMultiplier =
        Number(phase13HedgeFundBrain.hedgeFundSizingMultiplier || 1);
      const phase14GovernorSizingMultiplier =
        Number(
          phase14Governor.governorSizingMultiplier || 1);
      const phase15ExecutionSizingMultiplier =
        Number(
          phase15ExecutionDominance.executionSizingMultiplier || 1
        );
      const phase10RunnerSizingMultiplier =
        phase10RunnerMemory.continuationProbability >= 85
          ? 1.18
          : phase10RunnerMemory.continuationProbability >= 72
            ? 1.1
            : phase10RunnerMemory.continuationProbability >= 60
              ? 1.04
              : 1;
      const weakSetupPenalty =
        Number(candidate.score || 0) < 70
          ? 0.55
          : Number(candidate.score || 0) < 75
            ? 0.72
            : 1;
      const marketPhaseSizingMultiplier =
        Number(
          engineState.marketCycleIntelligenceState?.buyAggressionMultiplier || 1
        );
      const sectorDominanceMultiplier =
        Number(candidate.sectorDominance?.dominanceMultiplier || 1);
      const eliteHeatMultiplier =
        Number(
          candidate.eliteRunnerHeatOverride?.heatOverrideMultiplier || 1
        );
      const adaptiveAggressionMultiplier =
        Number(
          candidate.adaptiveAggression?.aggressionMultiplier || 1
        );
      const liquidityTrapMultiplier =
        Number(candidate.liquiditySweepTrap?.liquidityTimingMultiplier || 1);
      const entryTimingMultiplier =
        Number(candidate.entryTiming?.timingMultiplier || 1);
      const phase16PortfolioParliament =
        calculatePhase16InstitutionalPortfolioParliament({
          signal: candidate,
          account,
          managedPositions,
          proposedTradeAmount: executionAdjustedBaseTradeAmount,
          portfolioManager,
        });
      if (phase16PortfolioParliament.blockByPortfolioParliament) {
        recordOrder(
          "AUTO_STOCK_BUY_SKIPPED_PHASE_16_PORTFOLIO_PARLIAMENT",
          symbol,
          {
            score: candidate.score,
            phase16PortfolioParliament,
            reason:
              "Phase 16 blocked entry because portfolio heat/correlation risk is too high.",
          }
        );
        continue;
      }
      const phase16PortfolioParliamentSizingMultiplier =
        Number(
          phase16PortfolioParliament.portfolioParliamentMultiplier || 1
        );
      const capitalPressure =
        calculateAutonomousCapitalPressure({
          signal: candidate,
          account,
          managedPositions,
          baseTradeAmount: executionAdjustedBaseTradeAmount,
          portfolioManager,
          parliamentGate,
          institutionalExecutionPlan,
          reinforcementSizing,
        });
      const suppressionBalancer =
        calculateAdaptiveSuppressionBalancer({
          candidate,
          capitalPressure,
          orchestratorGate,
          parliamentGate,
          autonomousConfidenceMultiplier,
          regimeProtectionMultiplier,
          reinforcementSizing,
          weakSetupPenalty,
          eliteHeatMultiplier,
          adaptiveAggressionMultiplier,
          marketPhaseSizingMultiplier,
          sectorDominanceMultiplier,
          liquidityTrapMultiplier,
          entryTimingMultiplier,
        });
      const phase34AdaptiveAggressionBalancer =
        calculatePhase34AdaptiveAggressionBalancer({
          candidate,
          account,
          managedPositions,
          portfolioManager,
          institutionalExecutionPlan,
          phase14Governor,
          phase15ExecutionDominance,
          phase16PortfolioParliament,
          capitalPressure,
          suppressionBalancer,
        });
      const phase34AggressionSizingMultiplier =
        Number(phase34AdaptiveAggressionBalancer.aggressionMultiplier || 1);
      const phase35AiGovernanceLayer =
        calculatePhase35AiGovernanceLayer({
          candidate,
          account,
          managedPositions,
          portfolioManager,
          institutionalExecutionPlan,
          phase14Governor,
          phase15ExecutionDominance,
          phase16PortfolioParliament,
          phase34AdaptiveAggressionBalancer,
          capitalPressure,
          suppressionBalancer,
        });
      if (
        phase35AiGovernanceLayer.governanceAction === "BLOCK" ||
        phase35AiGovernanceLayer.governanceAction === "WATCHLIST_ONLY"
      ) {
        recordOrder(
          "AUTO_STOCK_BUY_SKIPPED_PHASE_35_AI_GOVERNANCE",
          symbol,
          {
            score: candidate.score,
            phase35AiGovernanceLayer,
            reason:
              "Phase 35 AI Governance Layer blocked or watchlisted this trade.",
          }
        );
        continue;
      }
      const phase35GovernanceSizingMultiplier =
        Number(phase35AiGovernanceLayer.governanceMultiplier || 1);
      const phase36PredictiveExecutionTiming =
        calculatePhase36PredictiveExecutionTiming({
          candidate,
          institutionalExecutionPlan,
          phase15ExecutionDominance,
          phase35AiGovernanceLayer,
        });
      if (
        phase36PredictiveExecutionTiming.timingAction === "AVOID_EXHAUSTION_ENTRY" ||
        phase36PredictiveExecutionTiming.timingAction === "RESPECT_GOVERNANCE_BLOCK"
      ) {
        recordOrder(
          "AUTO_STOCK_BUY_SKIPPED_PHASE_36_PREDICTIVE_TIMING",
          symbol,
          {
            score: candidate.score,
            phase36PredictiveExecutionTiming,
            reason:
              "Phase 36 predictive timing avoided this entry due to exhaustion, liquidity, spread, or governance risk.",
          }
        );
        continue;
      }
      const phase36PredictiveTimingMultiplier =
        Number(phase36PredictiveExecutionTiming.timingMultiplier || 1);
      const phase37SelfBalancingAiEcosystem =
        calculatePhase37SelfBalancingAiEcosystem({
          candidate,
          phase14Governor,
          phase15ExecutionDominance,
          phase16PortfolioParliament,
          phase34AdaptiveAggressionBalancer,
          phase35AiGovernanceLayer,
          phase36PredictiveExecutionTiming,
          suppressionBalancer,
          capitalPressure,
        });
      const phase37EcosystemSizingMultiplier =
        Number(phase37SelfBalancingAiEcosystem.ecosystemMultiplier || 1);
      const phase38AutonomousCapitalParliament =
        calculatePhase38AutonomousCapitalParliament({
          candidate,
          account,
          managedPositions,
          portfolioManager,
          institutionalExecutionPlan,
          phase14Governor,
          phase15ExecutionDominance,
          phase16PortfolioParliament,
          phase34AdaptiveAggressionBalancer,
          phase35AiGovernanceLayer,
          phase36PredictiveExecutionTiming,
          phase37SelfBalancingAiEcosystem,
          capitalPressure,
        });
      if (phase38AutonomousCapitalParliament.parliamentDecision === "BLOCK_CAPITAL") {
        recordOrder(
          "AUTO_STOCK_BUY_SKIPPED_PHASE_38_CAPITAL_PARLIAMENT",
          symbol,
          {
            score: candidate.score,
            phase38AutonomousCapitalParliament,
            reason:
              "Phase 38 Autonomous Capital Parliament blocked capital authority for this trade.",
          }
        );
        continue;
      }
      const phase38CapitalParliamentSizingMultiplier =
        Number(phase38AutonomousCapitalParliament.capitalParliamentMultiplier || 1);
      const phase39MetaStrategyAi =
        calculatePhase39MetaStrategyAi({
          candidate,
          institutionalExecutionPlan,
          phase35AiGovernanceLayer,
          phase36PredictiveExecutionTiming,
          phase37SelfBalancingAiEcosystem,
          phase38AutonomousCapitalParliament,
        });
      const phase39MetaStrategySizingMultiplier =
        Number(phase39MetaStrategyAi.metaStrategyMultiplier || 1);
      const phase40RecursiveRealTimeLearning =
        calculatePhase40RecursiveRealTimeLearning({
          candidate,
          phase34AdaptiveAggressionBalancer,
          phase35AiGovernanceLayer,
          phase36PredictiveExecutionTiming,
          phase37SelfBalancingAiEcosystem,
          phase38AutonomousCapitalParliament,
          phase39MetaStrategyAi,
        });
      const phase40RecursiveLearningSizingMultiplier =
        Number(phase40RecursiveRealTimeLearning.recursiveLearningMultiplier || 1);
      const phase41InstitutionalCompression =
        calculatePhase41InstitutionalCompressionIntelligence({
          candidate,
          institutionalExecutionPlan,
          phase36PredictiveExecutionTiming,
          phase39MetaStrategyAi,
          phase40RecursiveRealTimeLearning,
        });
      const phase41CompressionSizingMultiplier =
        Number(phase41InstitutionalCompression.compressionMultiplier || 1);
      const capitalPressureSizingMultiplier =
        Number(capitalPressure.pressureMultiplier || 1);
      const finalMasterDecisionProfile =
        calculateFinalMasterDecisionProfile(candidate);
      candidate.finalMasterDecisionProfile =
        finalMasterDecisionProfile;
      candidate.masterFinalScore =
        finalMasterDecisionProfile.finalScore;
      candidate.masterFinalSizingMultiplier =
        finalMasterDecisionProfile.finalSizingMultiplier;
      candidate.masterExecutionDecision =
        finalMasterDecisionProfile.executionDecision;
      candidate.finalExitProfile =
        finalMasterDecisionProfile.finalExitProfile;
      if (finalMasterDecisionProfile.suppressEntry) {
        recordOrder(
          "AUTO_STOCK_BUY_SKIPPED_FINAL_MASTER_DECISION",
          symbol,
          {
            score: candidate.score,
            finalMasterDecisionProfile,
            reason:
              "Final master decision profile blocked this stock before sizing/execution.",
          }
        );
        continue;
      }
      const finalMasterDecisionSizingMultiplier =
        Number(finalMasterDecisionProfile.finalSizingMultiplier || 1);
      const rawSizingMultiplier =
        capitalPressureSizingMultiplier *
        finalMasterDecisionSizingMultiplier *
        autonomousConfidenceMultiplier *
        regimeProtectionMultiplier *
        Number(reinforcementSizing.learnedMultiplier || 1) *
        phase7SizingMultiplier *
        phase9LiquiditySizingMultiplier *
        phase10RunnerSizingMultiplier *
        phase11MetaStrategySizingMultiplier *
        phase12MacroSizingMultiplier *
        phase13HedgeFundSizingMultiplier *
        phase14GovernorSizingMultiplier *
        phase15ExecutionSizingMultiplier *
        phase16PortfolioParliamentSizingMultiplier *
        weakSetupPenalty *
        eliteHeatMultiplier *
        adaptiveAggressionMultiplier *
        marketPhaseSizingMultiplier *
        sectorDominanceMultiplier *
        liquidityTrapMultiplier *
        entryTimingMultiplier *
        suppressionBalancer.balancedMultiplier *
        phase34AggressionSizingMultiplier *
        phase35GovernanceSizingMultiplier *
        phase36PredictiveTimingMultiplier *
        phase37EcosystemSizingMultiplier *
        phase38CapitalParliamentSizingMultiplier *
        phase39MetaStrategySizingMultiplier *
        phase40RecursiveLearningSizingMultiplier *
        phase41CompressionSizingMultiplier;
      const finalInstitutionalNormalization =
        calculatePhase14FinalInstitutionalNormalization({
          candidate,
          account,
          managedPositions,
          rawSizingMultiplier,
          phase14Governor,
          phase16PortfolioParliament,
          capitalPressure,
          suppressionBalancer,
        });
      const phase20FinalExecutionGate =
        calculatePhase20FinalMasterExecutionGate({
          candidate,
          account,
          managedPositions,
          finalInstitutionalNormalization,
          phase14Governor,
          phase15ExecutionDominance,
          phase16PortfolioParliament,
          capitalPressure,
          suppressionBalancer,
        });
      if (
        phase20FinalExecutionGate.action === "BLOCK" ||
        phase20FinalExecutionGate.action === "WATCHLIST_ONLY"
      ) {
        recordOrder(
          "AUTO_STOCK_BUY_SKIPPED_PHASE_20_FINAL_MASTER_GATE",
          symbol,
          {
            score: candidate.score,
            phase20FinalExecutionGate,
            reason:
              "Phase 20 final master gate blocked or watchlisted this trade before execution.",
          }
        );
        continue;
      }
      const finalSizingMultiplier =
        phase20FinalExecutionGate.masterFinalSizingMultiplier;
      const uncappedTradeAmount = Number(
        (
          executionAdjustedBaseTradeAmount *
          finalSizingMultiplier
        ).toFixed(2)
      );
      const finalTradeAmount = Number(
        Math.min(
          uncappedTradeAmount,
          Number(capitalPressure.capitalPressureAmount || uncappedTradeAmount),
          Math.max(0, remainingBotBudget - stockBudgetReservedThisCycle),
          Number(account.cash || 0),
          Number(account.buying_power || account.cash || 0)
        ).toFixed(2)
      );
      if (!finalTradeAmount || finalTradeAmount <= 0) {
        recordOrder("AUTO_STOCK_BUY_SKIPPED_SIZE_ZERO", symbol, {
          score: candidate.score,
          baseTradeAmount,
          portfolioManager,
          parliamentGate,
          institutionalExecutionPlan,
          autonomousConfidenceScore,
          autonomousConfidenceMultiplier,
          regimeProtectionMultiplier,
          reinforcementSizing,
          capitalPressure,
          suppressionBalancer,
        });
        continue;
      }
      try {
        const adaptiveExecution =
          await executeAdaptiveBuyOrder({
            signal: candidate,
            totalAmount: finalTradeAmount,
            assetClass: "stock",
          });
        markAiManagedSymbol(symbol);
        engineState.aiEntryScores[symbol] = {
          score: candidate.score,
          institutionalScore: candidate.institutionalScore,
          entryType: morningStrikeOverrideGate.allowed
            ? "MORNING_STRIKE"
            : eliteMomentumExceptionGate.allowed
              ? "ELITE_MOMENTUM_EXCEPTION"
              : "AUTO_STOCK_ENTRY",
          morningStrike: morningStrikeOverrideGate.allowed,
          eliteMomentumException: eliteMomentumExceptionGate.allowed,
          technicalScore: candidate.technicalScore,
          autonomousConfidenceScore,
          autonomousConfidenceMultiplier,
          regimeProtectionMultiplier,
          institutionalExecutionPlan,
          reinforcementSizing,
          phase7Reinforcement,
          phase7SizingMultiplier,
          phase9LiquidityIntelligence,
          phase9LiquiditySizingMultiplier,
          phase10RunnerMemory,
          phase10RunnerSizingMultiplier,
          phase11MetaStrategy,
          phase11MetaStrategySizingMultiplier,
          phase12MacroCorrelation,
          phase12MacroSizingMultiplier,
          phase13HedgeFundBrain,
          phase13HedgeFundSizingMultiplier,
          phase14Governor,
          phase14GovernorSizingMultiplier,
          phase15ExecutionDominance,
          phase15ExecutionSizingMultiplier,
          phase16PortfolioParliament,
          phase16PortfolioParliamentSizingMultiplier,
          phase34AdaptiveAggressionBalancer,
          phase34AggressionSizingMultiplier,
          phase35AiGovernanceLayer,
          phase35GovernanceSizingMultiplier,
          phase36PredictiveExecutionTiming,
          phase36PredictiveTimingMultiplier,
          phase37SelfBalancingAiEcosystem,
          phase37EcosystemSizingMultiplier,
          phase38AutonomousCapitalParliament,
          phase38CapitalParliamentSizingMultiplier,
          phase39MetaStrategyAi,
          phase39MetaStrategySizingMultiplier,
          phase40RecursiveRealTimeLearning,
          phase40RecursiveLearningSizingMultiplier,
          phase41InstitutionalCompression,
          phase41CompressionSizingMultiplier,
          statisticalScore: candidate.statisticalScore,
          setupType:
            classifyInstitutionalSetup({
              symbol,
              score: candidate.score,
              assetClass: "stock",
              marketRegime: engineState.marketRegime?.state,
              confirmations: candidate.confirmations || {},
              portfolioManager,
            }),
          enteredAt: new Date().toISOString(),
        };
        journalTradeEntry(symbol, {
          assetClass: "stock",
          entryType: "AUTO_STOCK_ENTRY",
          entryPrice: candidate.current || candidate.price,
          score: candidate.score,
          sector: candidate.estimatedSector || "General Market",
          marketRegime: engineState.marketRegime?.state,
          confirmations: candidate.confirmations || {},
          portfolioManager,
          institutionalExecutionPlan,
          autonomousConfidenceScore,
          autonomousConfidenceMultiplier,
          regimeProtectionMultiplier,
          tradeAmount: finalTradeAmount,
          reinforcementSizing,
          phase7Reinforcement,
          phase7SizingMultiplier,
        });
        recordOrder("AUTO_STOCK_BUY", symbol, {
          price: candidate.current || candidate.price,
          score: candidate.score,
          tradeAmount: finalTradeAmount,
          portfolioManager,
          orchestratorGate,
          parliamentGate,
          institutionalExecutionPlan,
          autonomousConfidenceScore,
          autonomousConfidenceMultiplier,
          regimeProtectionMultiplier,
          adaptiveExecution,
          reinforcementSizing,
        });
        stockBudgetReservedThisCycle += finalTradeAmount;
        markMorningTradeUsed(symbol);
        successfulStockBuysThisCycle += 1;
        if (successfulStockBuysThisCycle >= openSlots) {
          break;
        }
      } catch (err) {
        recordFailedOrder("AUTO_STOCK_BUY_FAILED", symbol, err.message, {
          score: candidate.score,
          finalTradeAmount,
        });
      }
    }
  }
  
  async function autoBuyCryptoSignals(signals) {
    const TRADING_MODE = getTradingMode();
    if (!["live_crypto", "smart"].includes(TRADING_MODE)) return;
    const account = await getAccount();
    const positions = await getPositions();
    const aiOwnedSymbols = await getBotOwnedSymbols();
    const aiPositions = positions.filter((position) =>
      isAiManagedOpenPosition(position, aiOwnedSymbols)
    );
    const aiCryptoPositions = aiPositions.filter((position) => {
      const symbol = normalizeSymbol(position.symbol);
      return symbol.includes("/") || position.asset_class === "crypto";
    });
    const managedPositions = aiPositions;
    const maxCryptoPositions = CONFIG.maxCryptoOpenTrades;
    const cryptoPositions = aiCryptoPositions;
    if (aiPositions.length >= CONFIG.maxOpenTrades) {
      if (aiCryptoPositions.length >= maxCryptoPositions) {
        const rotated = await rotateWeakCryptoIfBetter(signals, cryptoPositions);
        if (rotated) {
          return;
        }
      }
      recordOrder("AUTO_CRYPTO_BUY_SKIPPED", "CRYPTO", {
        reason: "Max crypto or total AI positions reached",
        cryptoOpen: aiCryptoPositions.length,
        totalOpen: aiPositions.length,
        maxCryptoOpenTrades: CONFIG.maxCryptoOpenTrades,
        maxOpenTrades: CONFIG.maxOpenTrades,
      });
      return;
    }
    const openSymbols = new Set(positions.map((p) => normalizeSymbol(p.symbol)));
    const cash = Number(account.cash || 0);
    if (cryptoPositions.length >= maxCryptoPositions) {
      const rotated = await rotateWeakCryptoIfBetter(signals, cryptoPositions);
      if (!rotated) {
        recordOrder("AUTO_CRYPTO_BUY_SKIPPED", "CRYPTO", {
          reason: "Max crypto positions reached, no stronger rotation found",
          maxCryptoPositions,
        });
      }
      return;
    }
    const openSlots = Math.min(
      CONFIG.maxOpenTrades - aiPositions.length,
      CONFIG.maxCryptoOpenTrades - aiCryptoPositions.length
    );
    if (openSlots <= 0) {
      recordOrder("AUTO_CRYPTO_BUY_SKIPPED", "CRYPTO", {
        reason: "Max crypto or total AI positions reached",
        cryptoOpen: aiCryptoPositions.length,
        totalOpen: aiPositions.length,
        maxCryptoOpenTrades: CONFIG.maxCryptoOpenTrades,
        maxOpenTrades: CONFIG.maxOpenTrades,
      });
      return;
    }
    const baseTradeAmount = getDynamicTradeAmount(account, cryptoPositions);
    const bestCandidateScore = Math.max(
      0,
      ...signals
        .filter(hasExplicitTradeApproval)
        .map((s) => getCryptoDecisionScore(s))
    );
    let scoreMultiplier = 0.5;
    if (bestCandidateScore >= 95) scoreMultiplier = 1;
    else if (bestCandidateScore >= 90) scoreMultiplier = 0.85;
    else if (bestCandidateScore >= 85) scoreMultiplier = 0.7;
    else if (bestCandidateScore >= 75) scoreMultiplier = 0.55;
    const tradeAmount = baseTradeAmount * scoreMultiplier;
    const effectiveCryptoBuyThreshold = CRYPTO_MIN_FINAL_SCORE_TO_BUY;
    if (tradeAmount < 1) {
      recordFailedOrder("AUTO_CRYPTO_BUY_SKIPPED", "CRYPTO", "Not enough budget");
      return;
    }
    const buyCandidates = signals
      .filter((s) => {
        const score = getCryptoDecisionScore(s);
        const spread = getMeasuredCryptoSpread(s);
        const institutionalPassed = hasExplicitTradeApproval(s);
        const completeEntryEvidence = hasCompleteCryptoEntryEvidence(s);
        return (
          institutionalPassed &&
          completeEntryEvidence &&
          score >= effectiveCryptoBuyThreshold &&
          spread !== null &&
          spread <= CRYPTO_MAX_ENTRY_SPREAD_PERCENT
        );
      })
      .filter((s) => {
        const sym = normalizeSymbol(s.symbol);
        const lastSold = engineState.lastSoldAt[sym] || 0;
        return !openSymbols.has(sym) && Date.now() - lastSold > 120000;
      })
      .sort(
        (a, b) =>
          getCryptoDecisionScore(b) -
          getCryptoDecisionScore(a)
      )
      .slice(0, openSlots);
    let cryptoBudgetReservedThisCycle = 0;
    for (const crypto of buyCandidates) {
      const symbol = normalizeSymbol(crypto.symbol);
      const cryptoInstitutionalScore = Number(
        crypto.institutionalScore ||
        crypto.score ||
        0
      );
      const cryptoTechnicalScore = Number(
        crypto.technicalScore ||
        crypto.technicalIntelligence?.institutionalEntryScore ||
        0
      );
      const cryptoStatisticalScore = Number(
        crypto.statisticalScore ||
        crypto.statisticalEdge?.statisticalEdgeScore ||
        0
      );
      const cryptoBarsFound = Number(crypto.barsFound || 0);
      const cryptoDecisionScore = getCryptoDecisionScore(crypto);
      const measuredCryptoSpread = getMeasuredCryptoSpread(crypto);
      const completeCryptoEntryEvidence = hasCompleteCryptoEntryEvidence(crypto);
      const cryptoQualified =
        hasExplicitTradeApproval(crypto) &&
        completeCryptoEntryEvidence &&
        cryptoDecisionScore >= effectiveCryptoBuyThreshold &&
        measuredCryptoSpread !== null &&
        measuredCryptoSpread <= CRYPTO_MAX_ENTRY_SPREAD_PERCENT &&
        cryptoBarsFound >= 10;
      if (!cryptoQualified) {
        recordOrder("CRYPTO_SKIPPED_INSTITUTIONAL_FILTER", symbol, {
          score: cryptoDecisionScore,
          spreadPercent: measuredCryptoSpread,
          barsFound: cryptoBarsFound,
          qualifiedToBuy: crypto.qualifiedToBuy,
        });
        continue;
      }
      const cryptoOrchestratorGate =
        passesInstitutionalOrchestratorBuyGate({
          ...crypto,
          assetClass: "crypto",
          asset_class: "crypto",
        });
      if (!cryptoOrchestratorGate.allowed) {
        recordOrder("CRYPTO_SKIPPED_ORCHESTRATOR", symbol, {
          reason: cryptoOrchestratorGate.reason,
        });
        continue;
      }
      const cryptoParliamentGate =
        passesAutonomousParliamentGate({
          ...crypto,
          assetClass: "crypto",
          asset_class: "crypto",
        });
      if (!cryptoParliamentGate.allowed) {
        recordOrder("CRYPTO_SKIPPED_PARLIAMENT", symbol, {
          reason: cryptoParliamentGate.reason,
        });
        continue;
      }
      if (shouldSkipFromTradeMemory(symbol)) {
        recordOrder("CRYPTO_SKIPPED_TRADE_MEMORY", symbol, {
          memory: engineState.tradeMemory?.[symbol],
        });
        continue;
      }
      try {
        const adaptiveCryptoSizing =
          calculateAdaptiveCryptoPositionSize(
            crypto,
            account
          );
        crypto.adaptiveCryptoSizing = adaptiveCryptoSizing;
        crypto.cryptoPositionSizing = adaptiveCryptoSizing;
        crypto.positionSizing = {
          ...adaptiveCryptoSizing,
          recommendedTradeAmount: Number(adaptiveCryptoSizing.recommendedAmount || 0),
          recommendedSize: Number(adaptiveCryptoSizing.recommendedAmount || 0),
        };
        crypto.recommendedTradeAmount = Number(adaptiveCryptoSizing.recommendedAmount || 0);
        crypto.rawRecommendedTradeAmount = Number(adaptiveCryptoSizing.recommendedAmount || 0);
        crypto.displayTradeAmount = Number(adaptiveCryptoSizing.recommendedAmount || 0);
        const cryptoConvictionMultiplier =
          cryptoInstitutionalScore >= 88 &&
            cryptoTechnicalScore >= 82 &&
            cryptoStatisticalScore >= 75
            ? 2.6
            : cryptoInstitutionalScore >= 80 &&
              cryptoTechnicalScore >= 72
              ? 1.9
              : cryptoInstitutionalScore >= 72
                ? 1.35
                : 0.65;
        const finalMasterDecisionProfile =
          calculateFinalMasterDecisionProfile({
            ...crypto,
            assetClass: "crypto",
            asset_class: "crypto",
          });
        crypto.finalMasterDecisionProfile =
          finalMasterDecisionProfile;
        crypto.masterFinalScore =
          finalMasterDecisionProfile.finalScore;
        crypto.masterFinalSizingMultiplier =
          finalMasterDecisionProfile.finalSizingMultiplier;
        crypto.masterExecutionDecision =
          finalMasterDecisionProfile.executionDecision;
        crypto.finalExitProfile =
          finalMasterDecisionProfile.finalExitProfile;
        if (finalMasterDecisionProfile.suppressEntry) {
          recordOrder(
            "AUTO_CRYPTO_BUY_SKIPPED_FINAL_MASTER_DECISION",
            symbol,
            {
              score: cryptoDecisionScore,
              finalMasterDecisionProfile,
              reason:
                "Final master decision profile blocked this crypto before sizing/execution.",
            }
          );
          continue;
        }
        const finalMasterCryptoSizingMultiplier =
          Number(finalMasterDecisionProfile.finalSizingMultiplier || 1);
        const availableCryptoBuyingPower =
          getCryptoAvailableBuyingPower(account);
        const totalBotExposure = getBotExposure(managedPositions);
        const totalMaxBotBudget =
          Number(account?.equity || 0) *
          (Number(CONFIG.maxBotExposurePercent || 15) / 100);
        const remainingTotalBotBudget = Math.max(
          0,
          totalMaxBotBudget - totalBotExposure - cryptoBudgetReservedThisCycle
        );
        const cryptoExposure = managedPositions.reduce((sum, position) => {
          const positionSymbol = normalizeSymbol(position.symbol);
          return isCrypto(positionSymbol)
            ? sum + Math.abs(Number(position.market_value || 0))
            : sum;
        }, 0);
        const cryptoMaxBudget =
          Number(account?.equity || 0) *
          (Number(CONFIG.maxBotExposurePercent || 0) / 100) *
          (Number(CONFIG.cryptoMaxExposureShareOfBotExposure || 30) / 100);
        const remainingCryptoBudget = Math.max(
          0,
          cryptoMaxBudget - cryptoExposure - cryptoBudgetReservedThisCycle
        );
        const rawFinalTradeAmount =
          adaptiveCryptoSizing.recommendedAmount *
          cryptoConvictionMultiplier *
          finalMasterCryptoSizingMultiplier *
          Number(cryptoParliamentGate.multiplier || 1);
        let finalTradeAmount = Number(
          Math.min(
            rawFinalTradeAmount,
            availableCryptoBuyingPower,
            remainingCryptoBudget,
            remainingTotalBotBudget
          ).toFixed(2)
        );
        const minCryptoTradeAmount = Number(
          CONFIG.minCryptoTradeAmount || CONFIG.minAutonomousTradeAmount || 25
        );
        if (finalTradeAmount > 0 && finalTradeAmount < minCryptoTradeAmount) {
          finalTradeAmount =
            availableCryptoBuyingPower >= minCryptoTradeAmount &&
              remainingCryptoBudget >= minCryptoTradeAmount &&
              remainingTotalBotBudget >= minCryptoTradeAmount
              ? minCryptoTradeAmount
              : 0;
        }
        crypto.finalApprovedTradeAmount = Number(finalTradeAmount || 0);
        crypto.finalTradeAmount = Number(finalTradeAmount || 0);
        crypto.displayTradeAmount = Number(finalTradeAmount || crypto.displayTradeAmount || 0);
        crypto.recommendedTradeAmount = Number(finalTradeAmount || crypto.recommendedTradeAmount || 0);
        crypto.rawRecommendedTradeAmount = Number(rawFinalTradeAmount || crypto.rawRecommendedTradeAmount || 0);
        crypto.finalSizingReconciliation = {
          rawFinalTradeAmount,
          finalTradeAmount,
          adaptiveRecommendedAmount: adaptiveCryptoSizing.recommendedAmount,
          cryptoConvictionMultiplier,
          finalMasterCryptoSizingMultiplier,
          parliamentMultiplier: Number(cryptoParliamentGate.multiplier || 1),
          availableCryptoBuyingPower,
          remainingCryptoBudget,
          remainingTotalBotBudget,
          minCryptoTradeAmount,
        };
        if (!finalTradeAmount || finalTradeAmount <= 0) {
          recordOrder(
            "AUTO_CRYPTO_BUY_SKIPPED_SIZE_ZERO",
            crypto.symbol,
            {
              score: cryptoDecisionScore,
              adaptiveCryptoSizing,
              finalSizingReconciliation: crypto.finalSizingReconciliation,
            }
          );
          continue;
        }
        const adaptiveExecution =
          await executeAdaptiveBuyOrder({
            signal: crypto,
            totalAmount: finalTradeAmount,
            assetClass: "crypto",
          });
        cryptoBudgetReservedThisCycle += finalTradeAmount;
        markAiManagedSymbol(symbol);
        journalTradeEntry(symbol, {
          assetClass: "crypto",
          entryType: "AUTO_CRYPTO_ENTRY",
          entryPrice: crypto.current || crypto.price,
          score: cryptoDecisionScore,
          sector: "Crypto",
          confirmations: crypto.confirmations || {},
          tradeAmount: finalTradeAmount,
        });
        recordOrder("AUTO_CRYPTO_BUY", crypto.symbol, {
          price: crypto.current,
          tradeAmount: finalTradeAmount,
          adaptiveCryptoSizing,
          cryptoOrchestratorGate,
          cryptoParliamentGate,
          adaptiveExecution,
        });
      } catch (err) {
        recordFailedOrder("AUTO_CRYPTO_BUY_FAILED", crypto.symbol, err.message);
      }
    }
  }

  return { autoBuySignals, autoBuyCryptoSignals };
}
