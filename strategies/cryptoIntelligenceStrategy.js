import {
  CRYPTO_MAX_ENTRY_SPREAD_PERCENT,
  getCryptoBaseAsset,
  pruneCryptoContinuationMemory,
  resolveCryptoLiquidityEvidence,
  updateCryptoContinuationMemoryEntry,
} from "../scoring/cryptoScoring.js";

export function createCryptoIntelligenceStrategy(dependencies) {
  const { calculateCryptoStrategySelection, clampScore, engineState, normalizeSymbol, saveEngineState } = dependencies;

  function recordCryptoScoreObservation(signal, phase, adjustment, reason) {
    signal.cryptoScoreObservations = signal.cryptoScoreObservations || {};
    const previous = signal.cryptoScoreObservations[phase];
    const nextAdjustment = Number(adjustment || 0);
    const deduplicatedAdjustment = previous
      ? previous.adjustment < 0 || nextAdjustment < 0
        ? Math.min(previous.adjustment, nextAdjustment)
        : Math.max(previous.adjustment, nextAdjustment)
      : nextAdjustment;
    signal.cryptoScoreObservations[phase] = {
      adjustment: deduplicatedAdjustment,
      reason,
      appliedToDecisionScore: false,
    };
  }

  function calculateCryptoInstitutionalSignal(signal = {}) {
    const symbol = normalizeSymbol(signal.symbol);
    const score = Number(signal.rawCryptoScore ?? signal.scannerScore ?? signal.score ?? 0);
    const bid = Number(signal.bid || 0);
    const ask = Number(signal.ask || 0);
    const percentChange = Number(signal.percentChange || signal.changePercent || 0);
    const volumeRatio = Number(
      signal.volumeRatio ||
      signal.relativeVolume ||
      signal.volumeSpikeRatio ||
      signal.confirmations?.volumeSpikeRatio ||
      0
    );
    const providedSpread = signal.spreadPercent === null || signal.spreadPercent === undefined
      ? undefined
      : Number(signal.spreadPercent);
    const quoteSpreadAvailable = bid > 0 && ask >= bid;
    const spreadAvailable = quoteSpreadAvailable || (
      signal.spreadAvailable !== false &&
        signal.spreadAvailable === true &&
        Number.isFinite(providedSpread) &&
        providedSpread >= 0
    );
    const spreadPercent = spreadAvailable
      ? quoteSpreadAvailable
        ? ((ask - bid) / ((ask + bid) / 2)) * 100
        : providedSpread
      : null;
    const isMajorCrypto = new Set(["BTC", "ETH", "SOL"]).has(
      getCryptoBaseAsset(symbol)
    );
    const liquidityScore = clampScore(
      45 +
      (isMajorCrypto ? 15 : 0) +
      (volumeRatio >= 1.5 ? 12 : 0) +
      (volumeRatio >= 3 ? 12 : 0) -
      (!spreadAvailable ? 15 : 0) -
      (spreadAvailable && spreadPercent >= 0.35 ? 15 : 0) -
      (spreadAvailable && spreadPercent >= 0.75 ? 25 : 0)
    );
    const momentumScore = clampScore(
      50 +
      (percentChange > 0 ? 12 : -8) +
      (percentChange >= 3 ? 10 : 0) +
      (percentChange >= 7 ? 8 : 0) -
      (percentChange <= -4 ? 18 : 0) -
      (Math.abs(percentChange) >= 18 ? 12 : 0)
    );
    const cryptoInstitutionalScore = clampScore(
      score * 0.35 +
      liquidityScore * 0.35 +
      momentumScore * 0.3
    );
    const cryptoRegime =
      cryptoInstitutionalScore >= 85
        ? "CRYPTO_INSTITUTIONAL_ACCUMULATION"
        : cryptoInstitutionalScore >= 72
          ? "CRYPTO_MOMENTUM_EXPANSION"
          : cryptoInstitutionalScore >= 60
            ? "CRYPTO_SELECTIVE"
            : "CRYPTO_RISK_OFF";
    const cryptoSizingMultiplier =
      cryptoRegime === "CRYPTO_INSTITUTIONAL_ACCUMULATION"
        ? 1.18
        : cryptoRegime === "CRYPTO_MOMENTUM_EXPANSION"
          ? 1.1
          : cryptoRegime === "CRYPTO_SELECTIVE"
            ? 0.95
            : 0.65;
    const suppressCrypto =
      !spreadAvailable ||
      cryptoRegime === "CRYPTO_RISK_OFF" ||
      (spreadAvailable && spreadPercent > CRYPTO_MAX_ENTRY_SPREAD_PERCENT) ||
      liquidityScore < 45;
    const scoreBoost =
      cryptoInstitutionalScore >= 85
        ? 7
        : cryptoInstitutionalScore >= 72
          ? 4
          : cryptoInstitutionalScore < 45
            ? -8
            : 0;
    return {
      phase: "42_FULL_CRYPTO_INSTITUTIONAL_ARCHITECTURE",
      updatedAt: new Date().toISOString(),
      symbol,
      cryptoRegime,
      cryptoInstitutionalScore,
      cryptoLiquidityScore: liquidityScore,
      cryptoMomentumScore: momentumScore,
      cryptoSizingMultiplier,
      suppressCrypto,
      scoreBoost,
      spreadAvailable,
      spreadPercent: spreadPercent === null ? null : Number(spreadPercent.toFixed(4)),
      reason: !spreadAvailable ? "MISSING_LIVE_SPREAD" : "STATE_UPDATED",
    };
  }
  
  function updateCryptoInstitutionalState(cryptoSignals = []) {
    const reviewed = cryptoSignals.map((signal) => {
      const phase42 =
        signal.phase42CryptoInstitutional ||
        calculateCryptoInstitutionalSignal(signal);
      return {
        symbol: signal.symbol,
        cryptoRegime: phase42.cryptoRegime,
        cryptoInstitutionalScore: phase42.cryptoInstitutionalScore,
        cryptoLiquidityScore: phase42.cryptoLiquidityScore,
        cryptoMomentumScore: phase42.cryptoMomentumScore,
        suppressCrypto: phase42.suppressCrypto,
      };
    });
    const approved = reviewed.filter((item) => !item.suppressCrypto);
    const blocked = reviewed.filter((item) => item.suppressCrypto);
    const state = {
      updatedAt: new Date().toISOString(),
      phase: "42_FULL_CRYPTO_INSTITUTIONAL_ARCHITECTURE",
      reviewedCount: reviewed.length,
      approvedCount: approved.length,
      blockedCount: blocked.length,
      topCryptoInstitutionalSetups: approved
        .sort(
          (a, b) =>
            Number(b.cryptoInstitutionalScore || 0) -
            Number(a.cryptoInstitutionalScore || 0)
        )
        .slice(0, 10),
      blockedCryptoSetups: blocked.slice(0, 10),
      reason: "STATE_UPDATED",
    };
    engineState.phase42CryptoInstitutionalState = state;
    if (!Array.isArray(engineState.phase42CryptoInstitutionalHistory)) {
      engineState.phase42CryptoInstitutionalHistory = [];
    }
    engineState.phase42CryptoInstitutionalHistory.unshift(state);
    engineState.phase42CryptoInstitutionalHistory =
      engineState.phase42CryptoInstitutionalHistory.slice(0, 200);
    engineState.cryptoInstitutionalMemory =
      engineState.cryptoInstitutionalMemory || {};
    for (const item of approved) {
      engineState.cryptoInstitutionalMemory[normalizeSymbol(item.symbol)] = {
        ...item,
        updatedAt: new Date().toISOString(),
      };
    }
    saveEngineState("PHASE_42_CRYPTO_INSTITUTIONAL_UPDATED");
    return state;
  }
  
  function calculateCryptoCapitalRotation(cryptoSignals = []) {
    const analyzed = Array.isArray(cryptoSignals) ? cryptoSignals : [];
    const approved = analyzed.filter(
      (signal) =>
        signal.qualifiedToBuy !== false &&
        signal.phase42Suppressed !== true
    );
    const topSignals = approved
      .map((signal) => {
        const phase42 = signal.phase42CryptoInstitutional || {};
        const score = Number(signal.score || 0);
        const cryptoScore = Number(
          phase42.cryptoInstitutionalScore ||
          signal.cryptoInstitutionalScore ||
          score
        );
        const liquidity = Number(
          phase42.cryptoLiquidityScore ||
          signal.cryptoLiquidityScore ||
          50
        );
        const momentum = Number(
          phase42.cryptoMomentumScore ||
          signal.cryptoMomentumScore ||
          50
        );
        const rotationScore = clampScore(
          score * 0.3 +
          cryptoScore * 0.35 +
          liquidity * 0.2 +
          momentum * 0.15
        );
        return {
          symbol: signal.symbol,
          score,
          cryptoInstitutionalScore: cryptoScore,
          cryptoLiquidityScore: liquidity,
          cryptoMomentumScore: momentum,
          rotationScore,
        };
      })
      .sort((a, b) => Number(b.rotationScore || 0) - Number(a.rotationScore || 0));
    const averageRotationScore =
      topSignals.length > 0
        ? topSignals.reduce(
          (sum, item) => sum + Number(item.rotationScore || 0),
          0
        ) / topSignals.length
        : 0;
    const eliteCount = topSignals.filter(
      (item) => Number(item.rotationScore || 0) >= 82
    ).length;
    const weakCount = analyzed.filter(
      (signal) =>
        signal.qualifiedToBuy === false ||
        signal.phase42Suppressed === true
    ).length;
    const cryptoCapitalMode =
      eliteCount >= 2 && averageRotationScore >= 78
        ? "CRYPTO_AGGRESSIVE_ROTATION"
        : averageRotationScore >= 68
          ? "CRYPTO_SELECTIVE_ROTATION"
          : averageRotationScore >= 55
            ? "CRYPTO_DEFENSIVE_ROTATION"
            : "STABLECOIN_DEFENSE_MODE";
    const cryptoCapitalMultiplier =
      cryptoCapitalMode === "CRYPTO_AGGRESSIVE_ROTATION"
        ? 1.2
        : cryptoCapitalMode === "CRYPTO_SELECTIVE_ROTATION"
          ? 1
          : cryptoCapitalMode === "CRYPTO_DEFENSIVE_ROTATION"
            ? 0.65
            : 0.25;
    const shouldBlockWeakCrypto =
      cryptoCapitalMode === "STABLECOIN_DEFENSE_MODE";
    const state = {
      updatedAt: new Date().toISOString(),
      phase: "43_CRYPTO_CAPITAL_ROTATION_STABLECOIN_DEFENSE",
      reviewedCount: analyzed.length,
      approvedCount: approved.length,
      weakCount,
      eliteCount,
      averageRotationScore: Number(averageRotationScore.toFixed(2)),
      cryptoCapitalMode,
      cryptoCapitalMultiplier,
      shouldBlockWeakCrypto,
      topCryptoRotationCandidates: topSignals.slice(0, 10),
      reason:
        0
    };
    engineState.phase43CryptoCapitalRotationState = state;
    if (!Array.isArray(engineState.phase43CryptoCapitalRotationHistory)) {
      engineState.phase43CryptoCapitalRotationHistory = [];
    }
    engineState.phase43CryptoCapitalRotationHistory.unshift(state);
    engineState.phase43CryptoCapitalRotationHistory =
      engineState.phase43CryptoCapitalRotationHistory.slice(0, 200);
    engineState.cryptoCapitalRotationMemory =
      engineState.cryptoCapitalRotationMemory || {};
    for (const item of topSignals.slice(0, 10)) {
      engineState.cryptoCapitalRotationMemory[normalizeSymbol(item.symbol)] = {
        ...item,
        updatedAt: state.updatedAt,
        cryptoCapitalMode,
      };
    }
    saveEngineState("PHASE_43_CRYPTO_CAPITAL_ROTATION_UPDATED");
    return state;
  }
  
  function applyCryptoCapitalRotationToSignals(
    cryptoSignals = [],
    phase43State = {}
  ) {
    return cryptoSignals.map((signal) => {
      const symbol = normalizeSymbol(signal.symbol);
      const memory =
        engineState.cryptoCapitalRotationMemory?.[symbol] || {};
      const rotationScore = Number(memory.rotationScore || 0);
      const multiplier = Number(
        phase43State.cryptoCapitalMultiplier || 1
      );
      signal.phase43CryptoCapitalRotation = {
        phase: "43_CRYPTO_CAPITAL_ROTATION_STABLECOIN_DEFENSE",
        cryptoCapitalMode:
          phase43State.cryptoCapitalMode || "UNKNOWN",
        rotationScore,
        cryptoCapitalMultiplier: multiplier,
        shouldBlockWeakCrypto:
          phase43State.shouldBlockWeakCrypto === true,
        reason: phase43State.reason || "",
      };
      signal.cryptoCapitalRotationScore = rotationScore;
      signal.cryptoCapitalMultiplier = multiplier;
      if (
        phase43State.shouldBlockWeakCrypto === true &&
        rotationScore < 65
      ) {
        signal.qualifiedToBuy = false;
        signal.phase43Suppressed = true;
        signal.phase43SuppressionReason =
          "Phase 43 stablecoin defense blocked weak crypto setup.";
      }
      if (rotationScore >= 82 && multiplier > 1) {
        recordCryptoScoreObservation(signal, "phase43", 4, "elite capital rotation");
      }
      if (rotationScore < 50) {
        recordCryptoScoreObservation(signal, "phase43", -5, "weak capital rotation");
      }
      return signal;
    });
  }
  
  function calculateCryptoExecutionTiming(signal = {}) {
    const symbol = normalizeSymbol(signal.symbol);
    const bid = Number(signal.bid || 0);
    const ask = Number(signal.ask || 0);
    const providedSpread = signal.spreadPercent === null || signal.spreadPercent === undefined
      ? undefined
      : Number(signal.spreadPercent);
    const quoteSpreadAvailable = bid > 0 && ask >= bid;
    const spreadAvailable = quoteSpreadAvailable || (
      signal.spreadAvailable !== false &&
        signal.spreadAvailable === true &&
        Number.isFinite(providedSpread) &&
        providedSpread >= 0
    );
    const spreadPercent = spreadAvailable
      ? quoteSpreadAvailable
        ? ((ask - bid) / ((ask + bid) / 2)) * 100
        : providedSpread
      : null;
    const volumeSpikeRatio = Number(
      signal.volumeSpikeRatio ||
      signal.confirmations?.volumeSpikeRatio ||
      signal.relativeVolume ||
      0
    );
    const liquidityEvidence = resolveCryptoLiquidityEvidence(signal);
    const liquiditySource = liquidityEvidence.source;
    const dollarVolume = liquidityEvidence.dollarVolume;
    const liquidityThresholds = {
      minimum: liquidityEvidence.minimum,
      probeMinimum: liquidityEvidence.probeMinimum,
    };
    const percentChange = Number(
      signal.percentChange || signal.changePercent || 0
    );
    const spreadScore = spreadAvailable
      ? clampScore(
        100 -
        spreadPercent * 120 -
        (spreadPercent >= 0.4 ? 18 : 0) -
        (spreadPercent >= 0.75 ? 30 : 0)
      )
      : 50;
    const liquidityExecutionScore = clampScore(
      45 +
      (volumeSpikeRatio >= 1 ? 10 : 0) +
      (volumeSpikeRatio >= 2 ? 12 : 0) +
      (dollarVolume >= liquidityThresholds.minimum ? 20 : 0) +
      (dollarVolume >= liquidityThresholds.probeMinimum &&
        dollarVolume < liquidityThresholds.minimum ? 8 : 0) -
      (dollarVolume < liquidityThresholds.probeMinimum ? 20 : 0)
    );
    const timingScore = clampScore(
      55 +
      (percentChange > 0 ? 10 : -4) +
      (percentChange >= 2 ? 8 : 0) +
      (percentChange <= -4 ? -14 : 0) -
      (Math.abs(percentChange) >= 15 ? 16 : 0)
    );
    const cryptoExecutionScore = clampScore(
      spreadScore * 0.4 +
      liquidityExecutionScore * 0.35 +
      timingScore * 0.25
    );
    const executionDecision =
      cryptoExecutionScore >= 82
        ? "EXECUTE_NOW"
        : cryptoExecutionScore >= 68
          ? "EXECUTE_CAREFULLY"
          : cryptoExecutionScore >= 55
            ? "WAIT_FOR_BETTER_FILL"
            : "BLOCK_BAD_CRYPTO_EXECUTION";
    const executionMultiplier =
      executionDecision === "EXECUTE_NOW"
        ? 1.08
        : executionDecision === "EXECUTE_CAREFULLY"
          ? 0.92
          : executionDecision === "WAIT_FOR_BETTER_FILL"
            ? 0.55
            : 0;
    const blockExecution =
      !spreadAvailable ||
      dollarVolume <= 0 ||
      executionDecision === "BLOCK_BAD_CRYPTO_EXECUTION" ||
      (spreadAvailable && spreadPercent > CRYPTO_MAX_ENTRY_SPREAD_PERCENT) ||
      spreadScore < 35;
    return {
      phase: "44_CRYPTO_EXECUTION_TIMING_SLIPPAGE_DEFENSE",
      updatedAt: new Date().toISOString(),
      symbol,
      cryptoExecutionScore,
      spreadScore,
      liquidityExecutionScore,
      timingScore,
      spreadAvailable,
      spreadPercent: spreadPercent === null ? null : Number(spreadPercent.toFixed(4)),
      liquiditySource,
      liquidityMinimumDollarVolume: liquidityThresholds.minimum,
      executionDecision,
      executionMultiplier,
      blockExecution,
      reason: !spreadAvailable
        ? "MISSING_LIVE_SPREAD"
        : dollarVolume <= 0
          ? "MISSING_LIQUIDITY"
          : "STATE_UPDATED",
    };
  }
  
  function updateCryptoExecutionTimingState(cryptoSignals = []) {
    const reviewed = cryptoSignals.map((signal) =>
      calculateCryptoExecutionTiming(signal)
    );
    const executable = reviewed.filter((item) => !item.blockExecution);
    const blocked = reviewed.filter((item) => item.blockExecution);
    const avgExecutionScore =
      reviewed.length > 0
        ? reviewed.reduce(
          (sum, item) => sum + Number(item.cryptoExecutionScore || 0),
          0
        ) / reviewed.length
        : 0;
    const state = {
      updatedAt: new Date().toISOString(),
      phase: "44_CRYPTO_EXECUTION_TIMING_SLIPPAGE_DEFENSE",
      reviewedCount: reviewed.length,
      executableCount: executable.length,
      blockedCount: blocked.length,
      avgExecutionScore: Number(avgExecutionScore.toFixed(2)),
      topExecutableCrypto: executable
        .sort(
          (a, b) =>
            Number(b.cryptoExecutionScore || 0) -
            Number(a.cryptoExecutionScore || 0)
        )
        .slice(0, 10),
      blockedCryptoExecution: blocked.slice(0, 10),
      reason: "STATE_UPDATED",
    };
    engineState.phase44CryptoExecutionTimingState = state;
    if (!Array.isArray(engineState.phase44CryptoExecutionTimingHistory)) {
      engineState.phase44CryptoExecutionTimingHistory = [];
    }
    engineState.phase44CryptoExecutionTimingHistory.unshift(state);
    engineState.phase44CryptoExecutionTimingHistory =
      engineState.phase44CryptoExecutionTimingHistory.slice(0, 200);
    engineState.cryptoExecutionTimingMemory =
      engineState.cryptoExecutionTimingMemory || {};
    for (const item of reviewed) {
      engineState.cryptoExecutionTimingMemory[normalizeSymbol(item.symbol)] = item;
    }
    saveEngineState("PHASE_44_CRYPTO_EXECUTION_TIMING_UPDATED");
    return state;
  }
  
  function applyCryptoExecutionTimingToSignals(cryptoSignals = []) {
    return cryptoSignals.map((signal) => {
      const phase44 = calculateCryptoExecutionTiming(signal);
      signal.phase44CryptoExecutionTiming = phase44;
      signal.cryptoExecutionScore = phase44.cryptoExecutionScore;
      signal.cryptoExecutionDecision = phase44.executionDecision;
      signal.cryptoExecutionMultiplier = phase44.executionMultiplier;
      if (phase44.blockExecution) {
        signal.qualifiedToBuy = false;
        signal.phase44Suppressed = true;
        signal.phase44SuppressionReason = phase44.reason;
      }
      if (phase44.executionDecision === "EXECUTE_NOW") {
        recordCryptoScoreObservation(signal, "phase44", 3, "execute now");
      }
      if (phase44.executionDecision === "WAIT_FOR_BETTER_FILL") {
        recordCryptoScoreObservation(signal, "phase44", -4, "wait for better fill");
      }
      return signal;
    });
  }
  
  function calculateCryptoPositionSizing(signal = {}) {
    const symbol = normalizeSymbol(signal.symbol);
    const score = Number(signal.score || 0);
    const percentChange = Number(signal.percentChange || signal.changePercent || 0);
    const phase42Score = Number(
      signal.cryptoInstitutionalScore ||
      signal.phase42CryptoInstitutional?.cryptoInstitutionalScore ||
      score
    );
    const phase43Score = Number(
      signal.cryptoCapitalRotationScore ||
      signal.phase43CryptoCapitalRotation?.rotationScore ||
      phase42Score
    );
    const phase44Score = Number(
      signal.cryptoExecutionScore ||
      signal.phase44CryptoExecutionTiming?.cryptoExecutionScore ||
      phase43Score
    );
    const volatilityPenalty =
      Math.abs(percentChange) >= 20
        ? 32
        : Math.abs(percentChange) >= 12
          ? 20
          : Math.abs(percentChange) >= 7
            ? 10
            : 0;
    const cryptoRiskScore = clampScore(
      100 -
      volatilityPenalty -
      (signal.phase42Suppressed ? 25 : 0) -
      (signal.phase43Suppressed ? 25 : 0) -
      (signal.phase44Suppressed ? 30 : 0) -
      (phase44Score < 55 ? 18 : 0)
    );
    const sizingScore = clampScore(
      phase42Score * 0.3 +
      phase43Score * 0.25 +
      phase44Score * 0.25 +
      cryptoRiskScore * 0.2
    );
    const positionSizeMode =
      sizingScore >= 86 && cryptoRiskScore >= 75
        ? "MAX_ELITE_CRYPTO_SIZE"
        : sizingScore >= 74
          ? "NORMAL_CRYPTO_SIZE"
          : sizingScore >= 60
            ? "REDUCED_CRYPTO_SIZE"
            : sizingScore >= 45
              ? "MICRO_CRYPTO_PROBE"
              : "BLOCK_CRYPTO_POSITION";
    const positionSizeMultiplier =
      positionSizeMode === "MAX_ELITE_CRYPTO_SIZE"
        ? 1.15
        : positionSizeMode === "NORMAL_CRYPTO_SIZE"
          ? 1
          : positionSizeMode === "REDUCED_CRYPTO_SIZE"
            ? 0.65
            : positionSizeMode === "MICRO_CRYPTO_PROBE"
              ? 0.3
              : 0;
    const blockPosition =
      positionSizeMode === "BLOCK_CRYPTO_POSITION" ||
      signal.qualifiedToBuy === false ||
      cryptoRiskScore < 35;
    return {
      phase: "45_CRYPTO_POSITION_SIZING_VOLATILITY_RISK",
      updatedAt: new Date().toISOString(),
      symbol,
      sizingScore,
      cryptoRiskScore,
      positionSizeMode,
      positionSizeMultiplier,
      volatilityPenalty,
      blockPosition,
      phase42Score,
      phase43Score,
      phase44Score,
      reason: "STATE_UPDATED",
    };
  }
  
  function updateCryptoPositionSizingState(cryptoSignals = []) {
    const reviewed = cryptoSignals.map((signal) =>
      calculateCryptoPositionSizing(signal)
    );
    const blocked = reviewed.filter((item) => item.blockPosition);
    const tradable = reviewed.filter((item) => !item.blockPosition);
    const avgSizingScore =
      reviewed.length > 0
        ? reviewed.reduce(
          (sum, item) => sum + Number(item.sizingScore || 0),
          0
        ) / reviewed.length
        : 0;
    const state = {
      updatedAt: new Date().toISOString(),
      phase: "45_CRYPTO_POSITION_SIZING_VOLATILITY_RISK",
      reviewedCount: reviewed.length,
      tradableCount: tradable.length,
      blockedCount: blocked.length,
      avgSizingScore: Number(avgSizingScore.toFixed(2)),
      topSizedCryptoSetups: tradable
        .sort(
          (a, b) =>
            Number(b.sizingScore || 0) - Number(a.sizingScore || 0)
        )
        .slice(0, 10),
      blockedCryptoSizing: blocked.slice(0, 10),
      reason: "STATE_UPDATED",
    };
    engineState.phase45CryptoPositionSizingState = state;
    if (!Array.isArray(engineState.phase45CryptoPositionSizingHistory)) {
      engineState.phase45CryptoPositionSizingHistory = [];
    }
    engineState.phase45CryptoPositionSizingHistory.unshift(state);
    engineState.phase45CryptoPositionSizingHistory =
      engineState.phase45CryptoPositionSizingHistory.slice(0, 200);
    engineState.cryptoPositionSizingMemory =
      engineState.cryptoPositionSizingMemory || {};
    for (const item of reviewed) {
      engineState.cryptoPositionSizingMemory[normalizeSymbol(item.symbol)] = item;
    }
    saveEngineState("PHASE_45_CRYPTO_POSITION_SIZING_UPDATED");
    return state;
  }
  
  function applyCryptoPositionSizingToSignals(cryptoSignals = []) {
    return cryptoSignals.map((signal) => {
      const phase45 = calculateCryptoPositionSizing(signal);
      signal.phase45CryptoPositionSizing = phase45;
      signal.cryptoPositionSizingScore = phase45.sizingScore;
      signal.cryptoRiskScore = phase45.cryptoRiskScore;
      signal.cryptoPositionSizeMode = phase45.positionSizeMode;
      signal.cryptoPositionSizeMultiplier = phase45.positionSizeMultiplier;
      if (phase45.blockPosition) {
        signal.qualifiedToBuy = false;
        signal.phase45Suppressed = true;
        signal.phase45SuppressionReason = phase45.reason;
      }
      if (phase45.positionSizeMode === "MAX_ELITE_CRYPTO_SIZE") {
        recordCryptoScoreObservation(signal, "phase45", 3, "elite sizing evidence");
      }
      if (
        phase45.positionSizeMode === "MICRO_CRYPTO_PROBE" ||
        phase45.positionSizeMode === "REDUCED_CRYPTO_SIZE"
      ) {
        recordCryptoScoreObservation(signal, "phase45", -2, "reduced sizing evidence");
      }
      return signal;
    });
  }
  
  function calculateCryptoExitStrategy(signal = {}) {
    const symbol = normalizeSymbol(signal.symbol);
    const score = Number(signal.score || 0);
    const percentChange = Number(signal.percentChange || signal.changePercent || 0);
    const phase42Score = Number(
      signal.cryptoInstitutionalScore ||
      signal.phase42CryptoInstitutional?.cryptoInstitutionalScore ||
      score
    );
    const phase43Score = Number(
      signal.cryptoCapitalRotationScore ||
      signal.phase43CryptoCapitalRotation?.rotationScore ||
      phase42Score
    );
    const phase44Score = Number(
      signal.cryptoExecutionScore ||
      signal.phase44CryptoExecutionTiming?.cryptoExecutionScore ||
      phase43Score
    );
    const phase45RiskScore = Number(
      signal.cryptoRiskScore ||
  
      signal.phase45CryptoPositionSizing?.cryptoRiskScore ||
      50
    );
    const runnerStrength = clampScore(
      score * 0.25 +
      phase42Score * 0.25 +
      phase43Score * 0.2 +
      phase44Score * 0.15 +
      phase45RiskScore * 0.15
    );
    const profitProtectionPressure = clampScore(
      (percentChange >= 10 ? 28 : 0) +
      (percentChange >= 18 ? 22 : 0) +
      (percentChange <= -4 ? 25 : 0) +
      (percentChange <= -8 ? 25 : 0) +
      (phase45RiskScore < 50 ? 20 : 0) +
      (phase44Score < 55 ? 15 : 0)
    );
    const exitDecision =
      percentChange <= -10 || phase45RiskScore < 35
        ? "EMERGENCY_CRYPTO_EXIT"
        : profitProtectionPressure >= 70
          ? "PROTECT_CRYPTO_PROFIT"
          : runnerStrength >= 82 && profitProtectionPressure < 45
            ? "HOLD_CRYPTO_RUNNER"
            : runnerStrength >= 68
              ? "TRAIL_CRYPTO_RUNNER"
              : "REDUCE_WEAK_CRYPTO";
    const exitUrgency =
      exitDecision === "EMERGENCY_CRYPTO_EXIT"
        ? 100
        : exitDecision === "PROTECT_CRYPTO_PROFIT"
          ? 80
          : exitDecision === "REDUCE_WEAK_CRYPTO"
            ? 65
            : exitDecision === "TRAIL_CRYPTO_RUNNER"
              ? 35
              : 15;
    const shouldExit =
      exitDecision === "EMERGENCY_CRYPTO_EXIT" ||
      exitDecision === "PROTECT_CRYPTO_PROFIT" ||
      exitDecision === "REDUCE_WEAK_CRYPTO";
    return {
      phase: "46_CRYPTO_EXIT_PARLIAMENT_RUNNER_PROTECTION",
      updatedAt: new Date().toISOString(),
      symbol,
      runnerStrength,
      profitProtectionPressure,
      exitDecision,
      exitUrgency,
      shouldExit,
      phase42Score,
      phase43Score,
      phase44Score,
      phase45RiskScore,
      reason:
        `Urgency ${exitUrgency}/100`,
    };
  }
  
  function updateCryptoExitStrategyState(cryptoSignals = []) {
    const reviewed = cryptoSignals.map((signal) =>
      calculateCryptoExitStrategy(signal)
    );
    const exitCandidates = reviewed.filter((item) => item.shouldExit);
    const runners = reviewed.filter(
      (item) =>
        item.exitDecision === "HOLD_CRYPTO_RUNNER" ||
        item.exitDecision === "TRAIL_CRYPTO_RUNNER"
    );
    const avgRunnerStrength =
      reviewed.length > 0
        ? reviewed.reduce(
          (sum, item) => sum + Number(item.runnerStrength || 0),
          0
        ) / reviewed.length
        : 0;
    const state = {
      updatedAt: new Date().toISOString(),
      phase: "46_CRYPTO_EXIT_PARLIAMENT_RUNNER_PROTECTION",
      reviewedCount: reviewed.length,
      exitCandidateCount: exitCandidates.length,
      runnerCount: runners.length,
      avgRunnerStrength: Number(avgRunnerStrength.toFixed(2)),
      protectedCryptoRunners: runners
        .sort(
          (a, b) =>
            Number(b.runnerStrength || 0) - Number(a.runnerStrength || 0)
        )
        .slice(0, 10),
      cryptoExitCandidates: exitCandidates
        .sort(
          (a, b) => Number(b.exitUrgency || 0) - Number(a.exitUrgency || 0)
        )
        .slice(0, 10),
      reason:
        `${exitCandidates.length} exit candidates`,
    };
    engineState.phase46CryptoExitParliamentState = state;
    if (!Array.isArray(engineState.phase46CryptoExitParliamentHistory)) {
      engineState.phase46CryptoExitParliamentHistory = [];
    }
    engineState.phase46CryptoExitParliamentHistory.unshift(state);
    engineState.phase46CryptoExitParliamentHistory =
      engineState.phase46CryptoExitParliamentHistory.slice(0, 200);
    engineState.cryptoExitParliamentMemory =
      engineState.cryptoExitParliamentMemory || {};
    for (const item of reviewed) {
      engineState.cryptoExitParliamentMemory[normalizeSymbol(item.symbol)] = item;
    }
    saveEngineState("PHASE_46_CRYPTO_EXIT_PARLIAMENT_UPDATED");
    return state;
  }
  
  function applyCryptoExitStrategyToSignals(cryptoSignals = []) {
    return cryptoSignals.map((signal) => {
      const phase46 = calculateCryptoExitStrategy(signal);
      signal.phase46CryptoExitParliament = phase46;
      signal.cryptoRunnerStrength = phase46.runnerStrength;
      signal.cryptoProfitProtectionPressure =
        phase46.profitProtectionPressure;
      signal.cryptoExitDecision = phase46.exitDecision;
      signal.cryptoExitUrgency = phase46.exitUrgency;
      if (phase46.exitDecision === "HOLD_CRYPTO_RUNNER") {
        recordCryptoScoreObservation(signal, "phase46", 3, "runner hold evidence");
        signal.cryptoRunnerProtected = true;
      }
      if (phase46.exitDecision === "TRAIL_CRYPTO_RUNNER") {
        signal.cryptoRunnerTrailing = true;
      }
      if (
        phase46.exitDecision === "PROTECT_CRYPTO_PROFIT" ||
        phase46.exitDecision === "REDUCE_WEAK_CRYPTO"
      ) {
        recordCryptoScoreObservation(signal, "phase46", -3, "profit protection evidence");
        signal.cryptoExitWatch = true;
      }
      if (phase46.exitDecision === "EMERGENCY_CRYPTO_EXIT") {
        signal.qualifiedToBuy = false;
        signal.phase46Suppressed = true;
        signal.phase46SuppressionReason = phase46.reason;
      }
      return signal;
    });
  }
  
  function calculateCryptoLiquiditySweep(signal = {}) {
    const symbol = normalizeSymbol(signal.symbol);
    const score = Number(signal.score || 0);
    const current = Number(signal.current || signal.price || 0);
    const high = Number(signal.high || signal.h || current);
    const low = Number(signal.low || signal.l || current);
    const open = Number(signal.open || signal.o || current);
    const percentChange = Number(signal.percentChange || signal.changePercent || 0);
    const volumeSpikeRatio = Number(
      signal.volumeSpikeRatio ||
      signal.relativeVolume ||
      signal.confirmations?.volumeSpikeRatio ||
      0
    );
    const rangePercent =
      current > 0 && high > low ? ((high - low) / current) * 100 : 0;
    const closeNearHighPercent =
      high > low ? ((current - low) / (high - low)) * 100 : 50;
    const closeNearLowPercent =
      high > low ? ((high - current) / (high - low)) * 100 : 50;
    const upperWickPercent =
      high > low ? ((high - Math.max(current, open)) / (high - low)) * 100 : 0;
    const lowerWickPercent =
      high > low ? ((Math.min(current, open) - low) / (high - low)) * 100 : 0;
    const phase42Score = Number(
      signal.cryptoInstitutionalScore ||
      signal.phase42CryptoInstitutional?.cryptoInstitutionalScore ||
      score
    );
    const phase44Score = Number(
      signal.cryptoExecutionScore ||
      signal.phase44CryptoExecutionTiming?.cryptoExecutionScore ||
      phase42Score
    );
    const stopHuntRisk = clampScore(
      (rangePercent >= 4 ? 18 : 0) +
      (rangePercent >= 8 ? 22 : 0) +
      (volumeSpikeRatio >= 2 ? 18 : 0) +
      (upperWickPercent >= 45 ? 22 : 0) +
      (lowerWickPercent >= 45 ? 18 : 0) +
      (Math.abs(percentChange) >= 10 ? 15 : 0) -
      (phase42Score >= 80 ? 10 : 0)
    );
    const accumulationSweepScore = clampScore(
      (lowerWickPercent >= 35 ? 24 : 0) +
      (closeNearHighPercent >= 65 ? 22 : 0) +
      (volumeSpikeRatio >= 1.5 ? 18 : 0) +
      (percentChange >= 0 ? 12 : 0) +
      (phase42Score >= 75 ? 18 : 0) +
      (phase44Score >= 68 ? 10 : 0)
    );
    const distributionSweepScore = clampScore(
      (upperWickPercent >= 35 ? 24 : 0) +
      (closeNearLowPercent >= 65 ? 22 : 0) +
      (volumeSpikeRatio >= 1.5 ? 18 : 0) +
      (percentChange <= 0 ? 12 : 0) +
      (phase44Score < 55 ? 14 : 0)
    );
    const liquiditySweepDecision =
      distributionSweepScore >= 70 || stopHuntRisk >= 82
        ? "BLOCK_WHALE_TRAP"
        : accumulationSweepScore >= 75 && stopHuntRisk < 70
          ? "ACCUMULATION_SWEEP_CONFIRMED"
          : stopHuntRisk >= 65
            ? "WAIT_AFTER_LIQUIDITY_SWEEP"
            : accumulationSweepScore >= 58
              ? "CAUTIOUS_SWEEP_ENTRY"
              : "NO_MAJOR_SWEEP";
    const liquiditySweepScore = clampScore(
      accumulationSweepScore * 0.45 +
      (100 - stopHuntRisk) * 0.35 +
      phase44Score * 0.2 -
      distributionSweepScore * 0.2
    );
    const blockLiquidityTrap =
      liquiditySweepDecision === "BLOCK_WHALE_TRAP" ||
      distributionSweepScore >= 78;
    return {
      phase: "47_CRYPTO_LIQUIDITY_SWEEP_INTELLIGENCE",
      updatedAt: new Date().toISOString(),
      symbol,
      liquiditySweepDecision,
      liquiditySweepScore,
      stopHuntRisk,
      accumulationSweepScore,
      distributionSweepScore,
      rangePercent: Number(rangePercent.toFixed(4)),
      closeNearHighPercent: Number(closeNearHighPercent.toFixed(2)),
      closeNearLowPercent: Number(closeNearLowPercent.toFixed(2)),
      upperWickPercent: Number(upperWickPercent.toFixed(2)),
      lowerWickPercent: Number(lowerWickPercent.toFixed(2)),
      blockLiquidityTrap,
      reason: "STATE_UPDATED",
    };
  }
  
  function updateCryptoLiquiditySweepState(cryptoSignals = []) {
    const reviewed = cryptoSignals.map((signal) =>
      calculateCryptoLiquiditySweep(signal)
    );
    const blocked = reviewed.filter((item) => item.blockLiquidityTrap);
    const confirmed = reviewed.filter(
      (item) =>
        item.liquiditySweepDecision === "ACCUMULATION_SWEEP_CONFIRMED" ||
        item.liquiditySweepDecision === "CAUTIOUS_SWEEP_ENTRY"
    );
    const avgSweepScore =
      reviewed.length > 0
        ? reviewed.reduce(
          (sum, item) => sum + Number(item.liquiditySweepScore || 0),
          0
        ) / reviewed.length
        : 0;
    const state = {
      updatedAt: new Date().toISOString(),
      phase: "47_CRYPTO_LIQUIDITY_SWEEP_INTELLIGENCE",
      reviewedCount: reviewed.length,
      confirmedSweepCount: confirmed.length,
      blockedTrapCount: blocked.length,
      avgSweepScore: Number(avgSweepScore.toFixed(2)),
      confirmedLiquiditySweeps: confirmed
        .sort(
          (a, b) =>
            Number(b.liquiditySweepScore || 0) -
            Number(a.liquiditySweepScore || 0)
        )
        .slice(0, 10),
      blockedWhaleTraps: blocked
        .sort(
          (a, b) =>
            Number(b.stopHuntRisk || 0) - Number(a.stopHuntRisk || 0)
        )
        .slice(0, 10),
      reason: "STATE_UPDATED",
    };
    engineState.phase47CryptoLiquiditySweepState = state;
    if (!Array.isArray(engineState.phase47CryptoLiquiditySweepHistory)) {
      engineState.phase47CryptoLiquiditySweepHistory = [];
    }
    engineState.phase47CryptoLiquiditySweepHistory.unshift(state);
    engineState.phase47CryptoLiquiditySweepHistory =
      engineState.phase47CryptoLiquiditySweepHistory.slice(0, 200);
    engineState.cryptoLiquiditySweepMemory =
      engineState.cryptoLiquiditySweepMemory || {};
    for (const item of reviewed) {
      engineState.cryptoLiquiditySweepMemory[normalizeSymbol(item.symbol)] = item;
    }
    saveEngineState("PHASE_47_CRYPTO_LIQUIDITY_SWEEP_UPDATED");
    return state;
  }
  
  function applyCryptoLiquiditySweepToSignals(cryptoSignals = []) {
    return cryptoSignals.map((signal) => {
      const phase47 = calculateCryptoLiquiditySweep(signal);
      signal.phase47CryptoLiquiditySweep = phase47;
      signal.cryptoLiquiditySweepScore = phase47.liquiditySweepScore;
      signal.cryptoStopHuntRisk = phase47.stopHuntRisk;
      signal.cryptoLiquiditySweepDecision = phase47.liquiditySweepDecision;
      if (phase47.blockLiquidityTrap) {
        signal.qualifiedToBuy = false;
        signal.phase47Suppressed = true;
        signal.phase47SuppressionReason = phase47.reason;
        recordCryptoScoreObservation(signal, "phase47", -8, "liquidity trap");
      }
      if (phase47.liquiditySweepDecision === "ACCUMULATION_SWEEP_CONFIRMED") {
        recordCryptoScoreObservation(signal, "phase47", 5, "accumulation sweep");
        signal.cryptoAccumulationSweepConfirmed = true;
      }
      if (phase47.liquiditySweepDecision === "CAUTIOUS_SWEEP_ENTRY") {
        recordCryptoScoreObservation(signal, "phase47", 2, "cautious sweep entry");
        signal.cryptoCautiousSweepEntry = true;
      }
      if (phase47.liquiditySweepDecision === "WAIT_AFTER_LIQUIDITY_SWEEP") {
        recordCryptoScoreObservation(signal, "phase47", -4, "wait after sweep");
        signal.cryptoWaitAfterSweep = true;
      }
      return signal;
    });
  }
  
  function calculateCrossMarketCorrelation(
    stockSignals = [],
    cryptoSignals = []
  ) {
    const stocks = Array.isArray(stockSignals) ? stockSignals : [];
    const cryptos = Array.isArray(cryptoSignals) ? cryptoSignals : [];
    const stockAverageScore =
      stocks.length > 0
        ? stocks.reduce((sum, s) => sum + Number(s.score || 0), 0) /
        stocks.length
        : 50;
    const cryptoAverageScore =
      cryptos.length > 0
        ? cryptos.reduce((sum, s) => sum + Number(s.score || 0), 0) /
        cryptos.length
        : 50;
    const stockMomentum =
      stocks.length > 0
        ? stocks.reduce(
          (sum, s) =>
            sum + Number(s.percentChange || s.changePercent || 0),
          0
        ) / stocks.length
        : 0;
    const cryptoMomentum =
      cryptos.length > 0
        ? cryptos.reduce(
          (sum, s) =>
            sum + Number(s.percentChange || s.changePercent || 0),
          0
        ) / cryptos.length
        : 0;
    const marketRegime = engineState.marketRegime || {};
    const marketRegimeState = String(
      marketRegime.state || marketRegime.label || "unknown"
    ).toLowerCase();
    const riskOffRegime =
      marketRegimeState.includes("defensive") ||
      marketRegimeState.includes("panic") ||
      marketRegimeState.includes("bear") ||
      Number(engineState.marketStressLevel || 0) >= 7;
    const cryptoLeadershipSpread = cryptoAverageScore - stockAverageScore;
    const momentumSpread = cryptoMomentum - stockMomentum;
    const correlationScore = clampScore(
      55 +
      cryptoLeadershipSpread * 0.45 +
      momentumSpread * 2 +
      (cryptoAverageScore >= 75 ? 12 : 0) +
      (stockAverageScore >= 75 ? 6 : 0) -
      (riskOffRegime ? 18 : 0) -
      (cryptoMomentum < -3 ? 14 : 0)
    );
    const crossMarketMode =
      correlationScore >= 82 && cryptoLeadershipSpread >= 5
        ? "CRYPTO_LEADERSHIP_RISK_ON"
        : correlationScore >= 70
          ? "BALANCED_RISK_ON"
          : correlationScore >= 55
            ? "SELECTIVE_CORRELATION"
            : correlationScore >= 40
              ? "CORRELATION_DEFENSE"
              : "GLOBAL_RISK_OFF";
    const crossMarketMultiplier =
      crossMarketMode === "CRYPTO_LEADERSHIP_RISK_ON"
        ? 1.15
        : crossMarketMode === "BALANCED_RISK_ON"
          ? 1
          : crossMarketMode === "SELECTIVE_CORRELATION"
            ? 0.75
            : crossMarketMode === "CORRELATION_DEFENSE"
              ? 0.45
              : 0.2;
    const blockWeakCrypto =
      crossMarketMode === "GLOBAL_RISK_OFF" ||
      crossMarketMode === "CORRELATION_DEFENSE";
    const state = {
      updatedAt: new Date().toISOString(),
      phase: "48_CROSS_MARKET_CORRELATION_AI",
      stockSignalCount: stocks.length,
      cryptoSignalCount: cryptos.length,
      stockAverageScore: Number(stockAverageScore.toFixed(2)),
      cryptoAverageScore: Number(cryptoAverageScore.toFixed(2)),
      stockMomentum: Number(stockMomentum.toFixed(4)),
      cryptoMomentum: Number(cryptoMomentum.toFixed(4)),
      cryptoLeadershipSpread: Number(cryptoLeadershipSpread.toFixed(2)),
      momentumSpread: Number(momentumSpread.toFixed(4)),
      riskOffRegime,
      correlationScore: Number(correlationScore.toFixed(2)),
      crossMarketMode,
      crossMarketMultiplier,
      blockWeakCrypto,
      reason:
        `${crossMarketMode} • Correlation ${correlationScore.toFixed(2)}/100 • ` +
        `Momentum spread ${momentumSpread.toFixed(2)} • ` +
        `Crypto leadership spread ${cryptoLeadershipSpread.toFixed(2)}`,
    };
    engineState.phase48CrossMarketCorrelationState = state;
    if (!Array.isArray(engineState.phase48CrossMarketCorrelationHistory)) {
      engineState.phase48CrossMarketCorrelationHistory = [];
    }
    engineState.phase48CrossMarketCorrelationHistory.unshift(state);
    engineState.phase48CrossMarketCorrelationHistory =
      engineState.phase48CrossMarketCorrelationHistory.slice(0, 200);
    engineState.crossMarketCorrelationMemory =
      engineState.crossMarketCorrelationMemory || {};
    engineState.crossMarketCorrelationMemory.latest = state;
    saveEngineState("PHASE_48_CROSS_MARKET_CORRELATION_UPDATED");
    return state;
  }
  
  function applyCrossMarketCorrelationToSignals(
    cryptoSignals = [],
    phase48State = {}
  ) {
    return cryptoSignals.map((signal) => {
      const score = Number(signal.score || 0);
      const cryptoMomentum = Number(
        signal.percentChange || signal.changePercent || 0
      );
      const individualCorrelationScore = clampScore(
        score * 0.5 +
        Number(phase48State.correlationScore || 50) * 0.35 +
        (cryptoMomentum > 0 ? 10 : -5) +
        (signal.phase47Suppressed ? -15 : 0)
      );
      signal.phase48CrossMarketCorrelation = {
        phase: "48_CROSS_MARKET_CORRELATION_AI",
        crossMarketMode: phase48State.crossMarketMode || "UNKNOWN",
        correlationScore: phase48State.correlationScore || 0,
        individualCorrelationScore,
        crossMarketMultiplier:
          phase48State.crossMarketMultiplier || 1,
        blockWeakCrypto: phase48State.blockWeakCrypto === true,
        reason: phase48State.reason || "",
      };
      signal.crossMarketCorrelationScore = individualCorrelationScore;
      signal.crossMarketMultiplier =
        phase48State.crossMarketMultiplier || 1;
      if (
        phase48State.blockWeakCrypto === true &&
        individualCorrelationScore < 65
      ) {
        signal.qualifiedToBuy = false;
        signal.phase48Suppressed = true;
        signal.phase48SuppressionReason =
          "Phase 48 blocked weak crypto during cross-market risk-off defense.";
        recordCryptoScoreObservation(signal, "phase48", -7, "cross-market risk off");
      }
      if (
        phase48State.crossMarketMode === "CRYPTO_LEADERSHIP_RISK_ON" &&
        individualCorrelationScore >= 78
      ) {
        recordCryptoScoreObservation(signal, "phase48", 4, "crypto leadership");
        signal.cryptoLeadershipConfirmed = true;
      }
      if (phase48State.crossMarketMode === "BALANCED_RISK_ON") {
        recordCryptoScoreObservation(signal, "phase48", 1, "balanced risk on");
      }
      return signal;
    });
  }
  
  function calculateStablecoinFlowPressure(
    cryptoSignals = [],
    phase48State = {}
  ) {
    const cryptos = Array.isArray(cryptoSignals) ? cryptoSignals : [];
    const avgCryptoScore =
      cryptos.length > 0
        ? cryptos.reduce((sum, s) => sum + Number(s.score || 0), 0) /
        cryptos.length
        : 50;
    const avgMomentum =
      cryptos.length > 0
        ? cryptos.reduce(
          (sum, s) => sum + Number(s.percentChange || s.changePercent || 0),
          0
        ) / cryptos.length
        : 0;
    const avgExecution =
      cryptos.length > 0
        ? cryptos.reduce(
          (sum, s) => sum + Number(s.cryptoExecutionScore || 50),
          0
        ) / cryptos.length
        : 50;
    const avgSweepRisk =
      cryptos.length > 0
        ? cryptos.reduce(
          (sum, s) => sum + Number(s.cryptoStopHuntRisk || 0),
          0
        ) / cryptos.length
        : 0;
    const suppressedCount = cryptos.filter(
      (s) =>
        s.phase42Suppressed ||
        s.phase43Suppressed ||
        s.phase44Suppressed ||
        s.phase45Suppressed ||
        s.phase46Suppressed ||
        s.phase47Suppressed ||
        s.phase48Suppressed
    ).length;
    const advancingCount = cryptos.filter(
      (s) => Number(s.percentChange || s.changePercent || 0) > 0
    ).length;
    const decliningCount = cryptos.filter(
      (s) => Number(s.percentChange || s.changePercent || 0) < 0
    ).length;
    const cryptoBreadth =
      cryptos.length > 0 ? ((advancingCount - decliningCount) / cryptos.length) * 100 : 0;
    const exchangePressureScore = clampScore(
      50 -
      avgMomentum * 2 +
      avgSweepRisk * 0.35 +
      suppressedCount * 4 -
      cryptoBreadth * 0.25 -
      (avgExecution >= 70 ? 8 : 0) +
      (Number(phase48State.correlationScore || 50) < 50 ? 12 : 0)
    );
    const stablecoinDemandProxy = clampScore(
      45 +
      exchangePressureScore * 0.35 -
      avgCryptoScore * 0.2 -
      avgMomentum * 2 +
      (decliningCount > advancingCount ? 15 : 0) +
      (Number(phase48State.crossMarketMultiplier || 1) < 0.6 ? 12 : 0)
    );
    const flowMode =
      exchangePressureScore >= 78 || stablecoinDemandProxy >= 80
        ? "STABLECOIN_DEFENSE_ROTATION"
        : exchangePressureScore >= 62
          ? "EXCHANGE_PRESSURE_CAUTION"
          : stablecoinDemandProxy <= 35 && avgMomentum > 0
            ? "RISK_ON_CRYPTO_FLOW"
            : "NEUTRAL_STABLECOIN_FLOW";
    const stablecoinDefenseMultiplier =
      flowMode === "STABLECOIN_DEFENSE_ROTATION"
        ? 0.25
        : flowMode === "EXCHANGE_PRESSURE_CAUTION"
          ? 0.55
          : flowMode === "RISK_ON_CRYPTO_FLOW"
            ? 1.08
            : 0.85;
    const blockWeakCrypto =
      flowMode === "STABLECOIN_DEFENSE_ROTATION" ||
      flowMode === "EXCHANGE_PRESSURE_CAUTION";
    const state = {
      updatedAt: new Date().toISOString(),
      phase: "49_STABLECOIN_FLOW_EXCHANGE_PRESSURE",
      cryptoSignalCount: cryptos.length,
      advancingCount,
      decliningCount,
      suppressedCount,
      avgCryptoScore: Number(avgCryptoScore.toFixed(2)),
      avgMomentum: Number(avgMomentum.toFixed(4)),
      avgExecution: Number(avgExecution.toFixed(2)),
      avgSweepRisk: Number(avgSweepRisk.toFixed(2)),
      cryptoBreadth: Number(cryptoBreadth.toFixed(2)),
      exchangePressureScore: Number(exchangePressureScore.toFixed(2)),
      stablecoinDemandProxy: Number(stablecoinDemandProxy.toFixed(2)),
      flowMode,
      stablecoinDefenseMultiplier,
      blockWeakCrypto,
      reason: "APPLIED",
    };
    engineState.phase49StablecoinFlowState = state;
    if (!Array.isArray(engineState.phase49StablecoinFlowHistory)) {
      engineState.phase49StablecoinFlowHistory = [];
    }
    engineState.phase49StablecoinFlowHistory.unshift(state);
    engineState.phase49StablecoinFlowHistory =
      engineState.phase49StablecoinFlowHistory.slice(0, 200);
    engineState.stablecoinFlowMemory =
      engineState.stablecoinFlowMemory || {};
    engineState.stablecoinFlowMemory.latest = state;
    saveEngineState("PHASE_49_STABLECOIN_FLOW_UPDATED");
    return state;
  }
  
  function applyStablecoinFlowToSignals(
    cryptoSignals = [],
    phase49State = {}
  ) {
    return cryptoSignals.map((signal) => {
      const score = Number(signal.score || 0);
      const momentum = Number(signal.percentChange || signal.changePercent || 0);
      const executionScore = Number(signal.cryptoExecutionScore || 50);
      const sweepRisk = Number(signal.cryptoStopHuntRisk || 0);
      const stablecoinFlowSignalScore = clampScore(
        score * 0.45 +
        executionScore * 0.25 +
        Number(phase49State.avgCryptoScore || 50) * 0.15 +
        (momentum > 0 ? 10 : -8) -
        sweepRisk * 0.15 -
        Number(phase49State.exchangePressureScore || 50) * 0.2
      );
      signal.phase49StablecoinFlow = {
        phase: "49_STABLECOIN_FLOW_EXCHANGE_PRESSURE",
        flowMode: phase49State.flowMode || "UNKNOWN",
        stablecoinFlowSignalScore,
        exchangePressureScore: phase49State.exchangePressureScore || 0,
        stablecoinDemandProxy: phase49State.stablecoinDemandProxy || 0,
        stablecoinDefenseMultiplier:
          phase49State.stablecoinDefenseMultiplier || 1,
        blockWeakCrypto: phase49State.blockWeakCrypto === true,
        reason: phase49State.reason || "",
      };
      signal.stablecoinFlowSignalScore = stablecoinFlowSignalScore;
      signal.stablecoinDefenseMultiplier =
        phase49State.stablecoinDefenseMultiplier || 1;
      if (
        phase49State.blockWeakCrypto === true &&
        stablecoinFlowSignalScore < 68
      ) {
        signal.qualifiedToBuy = false;
        signal.phase49Suppressed = true;
        signal.phase49SuppressionReason =
          "Phase 49 blocked weak crypto during stablecoin/exchange pressure defense.";
        recordCryptoScoreObservation(signal, "phase49", -7, "stablecoin defense");
      }
      if (
        phase49State.flowMode === "RISK_ON_CRYPTO_FLOW" &&
        stablecoinFlowSignalScore >= 75
      ) {
        recordCryptoScoreObservation(signal, "phase49", 4, "risk-on crypto flow");
        signal.cryptoRiskOnFlowConfirmed = true;
      }
      if (phase49State.flowMode === "EXCHANGE_PRESSURE_CAUTION") {
        recordCryptoScoreObservation(signal, "phase49", -2, "exchange pressure caution");
        signal.cryptoExchangePressureCaution = true;
      }
      return signal;
    });
  }
  
  function calculateWhaleSmartMoney(signal = {}) {
    const symbol = normalizeSymbol(signal.symbol);
    const score = Number(signal.score || 0);
    const percentChange = Number(signal.percentChange || signal.changePercent || 0);
    const volumeSpikeRatio = Number(
      signal.volumeSpikeRatio ||
      signal.relativeVolume ||
      signal.confirmations?.volumeSpikeRatio ||
      0
    );
    const phase42Score = Number(
      signal.cryptoInstitutionalScore ||
      signal.phase42CryptoInstitutional?.cryptoInstitutionalScore ||
      score
    );
    const phase44Score = Number(
      signal.cryptoExecutionScore ||
      signal.phase44CryptoExecutionTiming?.cryptoExecutionScore ||
      50
    );
    const phase47SweepScore = Number(
      signal.cryptoLiquiditySweepScore ||
      signal.phase47CryptoLiquiditySweep?.liquiditySweepScore ||
      50
    );
    const stopHuntRisk = Number(
      signal.cryptoStopHuntRisk ||
      signal.phase47CryptoLiquiditySweep?.stopHuntRisk ||
      0
    );
    const stablecoinFlowScore = Number(
      signal.stablecoinFlowSignalScore ||
      signal.phase49StablecoinFlow?.stablecoinFlowSignalScore ||
      50
    );
    const accumulationProxy = clampScore(
      phase42Score * 0.28 +
      phase47SweepScore * 0.24 +
      phase44Score * 0.18 +
      stablecoinFlowScore * 0.15 +
      (volumeSpikeRatio >= 1.5 ? 10 : 0) +
      (volumeSpikeRatio >= 3 ? 10 : 0) +
      (percentChange > 0 ? 8 : -5) -
      (stopHuntRisk >= 75 ? 12 : 0)
    );
    const distributionProxy = clampScore(
      (stopHuntRisk >= 70 ? 25 : 0) +
      (signal.phase47Suppressed ? 20 : 0) +
      (signal.phase49Suppressed ? 15 : 0) +
      (percentChange <= -3 ? 14 : 0) +
      (percentChange <= -8 ? 18 : 0) +
      (volumeSpikeRatio >= 3 && percentChange < 0 ? 18 : 0) -
      (phase42Score >= 80 ? 10 : 0)
    );
    const whaleSmartMoneyScore = clampScore(
      accumulationProxy * 0.65 +
      phase42Score * 0.2 +
      phase44Score * 0.15 -
      distributionProxy * 0.35
    );
    const whaleDecision =
      distributionProxy >= 75
        ? "WHALE_DISTRIBUTION_AVOID"
        : whaleSmartMoneyScore >= 85
          ? "WHALE_ACCUMULATION_CONFIRMED"
          : whaleSmartMoneyScore >= 72
            ? "SMART_MONEY_ACCUMULATION"
            : whaleSmartMoneyScore >= 58
              ? "NEUTRAL_WHALE_FLOW"
              : "WEAK_WHALE_FLOW";
    const blockWhaleTrap =
      whaleDecision === "WHALE_DISTRIBUTION_AVOID" ||
      distributionProxy >= 80;
    return {
      phase: "50_WHALE_WALLET_SMART_MONEY_TRACKING",
      updatedAt: new Date().toISOString(),
      symbol,
      whaleDecision,
      whaleSmartMoneyScore,
      accumulationProxy,
      distributionProxy,
      volumeSpikeRatio,
      stopHuntRisk,
      blockWhaleTrap,
      reason: "STATE_UPDATED",
    };
  }
  
  function updateWhaleSmartMoneyState(cryptoSignals = []) {
    const reviewed = cryptoSignals.map((signal) =>
      calculateWhaleSmartMoney(signal)
    );
    const accumulation = reviewed.filter(
      (item) =>
        item.whaleDecision === "WHALE_ACCUMULATION_CONFIRMED" ||
        item.whaleDecision === "SMART_MONEY_ACCUMULATION"
    );
    const blocked = reviewed.filter((item) => item.blockWhaleTrap);
    const avgWhaleScore =
      reviewed.length > 0
        ? reviewed.reduce(
          (sum, item) => sum + Number(item.whaleSmartMoneyScore || 0),
          0
        ) / reviewed.length
        : 0;
    const state = {
      updatedAt: new Date().toISOString(),
      phase: "50_WHALE_WALLET_SMART_MONEY_TRACKING",
      reviewedCount: reviewed.length,
      accumulationCount: accumulation.length,
      blockedDistributionCount: blocked.length,
      avgWhaleScore: Number(avgWhaleScore.toFixed(2)),
      whaleAccumulationSetups: accumulation
        .sort(
          (a, b) =>
            Number(b.whaleSmartMoneyScore || 0) -
            Number(a.whaleSmartMoneyScore || 0)
        )
        .slice(0, 10),
      whaleDistributionAvoidList: blocked
        .sort(
          (a, b) =>
            Number(b.distributionProxy || 0) -
            Number(a.distributionProxy || 0)
        )
        .slice(0, 10),
      reason:
        `${blocked.length} distribution traps blocked`,
    };
    engineState.phase50WhaleSmartMoneyState = state;
    if (!Array.isArray(engineState.phase50WhaleSmartMoneyHistory)) {
      engineState.phase50WhaleSmartMoneyHistory = [];
    }
    engineState.phase50WhaleSmartMoneyHistory.unshift(state);
    engineState.phase50WhaleSmartMoneyHistory =
      engineState.phase50WhaleSmartMoneyHistory.slice(0, 200);
    engineState.whaleSmartMoneyMemory =
      engineState.whaleSmartMoneyMemory || {};
    for (const item of reviewed) {
      engineState.whaleSmartMoneyMemory[normalizeSymbol(item.symbol)] = item;
    }
    saveEngineState("PHASE_50_WHALE_SMART_MONEY_UPDATED");
    return state;
  }
  
  function applyWhaleSmartMoneyToSignals(cryptoSignals = []) {
    return cryptoSignals.map((signal) => {
      const phase50 = calculateWhaleSmartMoney(signal);
      signal.phase50WhaleSmartMoney = phase50;
      signal.whaleSmartMoneyScore = phase50.whaleSmartMoneyScore;
      signal.whaleDecision = phase50.whaleDecision;
      signal.whaleAccumulationProxy = phase50.accumulationProxy;
      signal.whaleDistributionProxy = phase50.distributionProxy;
      if (phase50.blockWhaleTrap) {
        signal.qualifiedToBuy = false;
        signal.phase50Suppressed = true;
        signal.phase50SuppressionReason = phase50.reason;
        recordCryptoScoreObservation(signal, "phase50", -8, "whale distribution trap");
      }
      if (phase50.whaleDecision === "WHALE_ACCUMULATION_CONFIRMED") {
        recordCryptoScoreObservation(signal, "phase50", 6, "whale accumulation");
        signal.whaleAccumulationConfirmed = true;
      }
      if (phase50.whaleDecision === "SMART_MONEY_ACCUMULATION") {
        recordCryptoScoreObservation(signal, "phase50", 3, "smart-money accumulation");
        signal.smartMoneyAccumulationConfirmed = true;
      }
      if (phase50.whaleDecision === "WEAK_WHALE_FLOW") {
        recordCryptoScoreObservation(signal, "phase50", -3, "weak whale flow");
        signal.weakWhaleFlow = true;
      }
      return signal;
    });
  }
  
  function calculateMultiTimeframeCrypto(signal = {}) {
    const symbol = normalizeSymbol(signal.symbol);
    const score = Number(signal.score || 0);
    const percentChange = Number(signal.percentChange || signal.changePercent || 0);
    const shortFrameScore = clampScore(
      score * 0.45 +
      Number(signal.cryptoExecutionScore || 50) * 0.3 +
      (percentChange > 0 ? 12 : -8) +
      (Math.abs(percentChange) >= 10 ? -8 : 0)
    );
    const midFrameScore = clampScore(
      Number(signal.cryptoLiquiditySweepScore || 50) * 0.3 +
      Number(signal.whaleSmartMoneyScore || 50) * 0.35 +
      Number(signal.cryptoCapitalRotationScore || 50) * 0.2 +
      Number(signal.stablecoinFlowSignalScore || 50) * 0.15
    );
    const longFrameScore = clampScore(
      Number(signal.cryptoInstitutionalScore || 50) * 0.35 +
      Number(signal.crossMarketCorrelationScore || 50) * 0.25 +
      Number(signal.cryptoRiskScore || 50) * 0.2 +
      Number(signal.cryptoRunnerStrength || 50) * 0.2
    );
    const timeframeAlignmentScore = clampScore(
      shortFrameScore * 0.34 +
      midFrameScore * 0.33 +
      longFrameScore * 0.33
    );
    const disagreementPenalty =
      Math.max(shortFrameScore, midFrameScore, longFrameScore) -
        Math.min(shortFrameScore, midFrameScore, longFrameScore) >=
        35
        ? 15
        : Math.max(shortFrameScore, midFrameScore, longFrameScore) -
          Math.min(shortFrameScore, midFrameScore, longFrameScore) >=
          25
          ? 8
          : 0;
    const finalParliamentScore = clampScore(
      timeframeAlignmentScore - disagreementPenalty
    );
    const parliamentDecision =
      finalParliamentScore >= 85
        ? "FULL_TIMEFRAME_ALIGNMENT"
        : finalParliamentScore >= 74
          ? "STRONG_TIMEFRAME_ALIGNMENT"
          : finalParliamentScore >= 62
            ? "PARTIAL_TIMEFRAME_ALIGNMENT"
            : finalParliamentScore >= 48
              ? "WAIT_FOR_TIMEFRAME_CONFIRMATION"
              : "BLOCK_TIMEFRAME_CONFLICT";
    const blockTimeframeConflict =
      parliamentDecision === "BLOCK_TIMEFRAME_CONFLICT" ||
      (parliamentDecision === "WAIT_FOR_TIMEFRAME_CONFIRMATION" &&
        signal.qualifiedToBuy === false);
    return {
      phase: "51_MULTI_TIMEFRAME_CRYPTO_PARLIAMENT",
      updatedAt: new Date().toISOString(),
      symbol,
      shortFrameScore,
      midFrameScore,
      longFrameScore,
      timeframeAlignmentScore,
      disagreementPenalty,
      finalParliamentScore,
      parliamentDecision,
      blockTimeframeConflict,
      reason: "STATE_UPDATED",
    };
  }
  
  function updateMultiTimeframeCryptoState(cryptoSignals = []) {
    const now = new Date();
    engineState.multiTimeframeCryptoMemory =
      engineState.multiTimeframeCryptoMemory || {};
    const reviewed = cryptoSignals.map((signal) => {
      const phase51 = calculateMultiTimeframeCrypto(signal);
      const symbol = normalizeSymbol(signal.symbol);
      const previous = engineState.multiTimeframeCryptoMemory[symbol] || {};
      const continuation = updateCryptoContinuationMemoryEntry(
        previous,
        signal,
        { now }
      );
      engineState.multiTimeframeCryptoMemory[symbol] = {
        ...phase51,
        ...continuation,
      };
      return {
        ...phase51,
        continuationScore: continuation.score,
        continuationCoverage: continuation.coverage,
        continuationAvailable: continuation.available,
        observedSessions: continuation.observedSessions,
      };
    });
    const aligned = reviewed.filter(
      (item) =>
        item.parliamentDecision === "FULL_TIMEFRAME_ALIGNMENT" ||
        item.parliamentDecision === "STRONG_TIMEFRAME_ALIGNMENT"
    );
    const blocked = reviewed.filter((item) => item.blockTimeframeConflict);
    const avgParliamentScore =
      reviewed.length > 0
        ? reviewed.reduce(
          (sum, item) => sum + Number(item.finalParliamentScore || 0),
          0
        ) / reviewed.length
        : 0;
    const state = {
      updatedAt: new Date().toISOString(),
      phase: "51_MULTI_TIMEFRAME_CRYPTO_PARLIAMENT",
      reviewedCount: reviewed.length,
      alignedCount: aligned.length,
      blockedConflictCount: blocked.length,
      avgParliamentScore: Number(avgParliamentScore.toFixed(2)),
      alignedCryptoSetups: aligned
        .sort(
          (a, b) =>
            Number(b.finalParliamentScore || 0) -
            Number(a.finalParliamentScore || 0)
        )
        .slice(0, 10),
      blockedTimeframeConflicts: blocked
        .sort(
          (a, b) =>
            Number(b.disagreementPenalty || 0) -
            Number(a.disagreementPenalty || 0)
        )
        .slice(0, 10),
      reason: "STATE_UPDATED",
    };
    engineState.phase51MultiTimeframeCryptoState = state;
    if (!Array.isArray(engineState.phase51MultiTimeframeCryptoHistory)) {
      engineState.phase51MultiTimeframeCryptoHistory = [];
    }
    engineState.phase51MultiTimeframeCryptoHistory.unshift(state);
    engineState.phase51MultiTimeframeCryptoHistory =
      engineState.phase51MultiTimeframeCryptoHistory.slice(0, 200);
    engineState.multiTimeframeCryptoMemory = pruneCryptoContinuationMemory(
      engineState.multiTimeframeCryptoMemory,
      { now }
    );
    saveEngineState("PHASE_51_MULTI_TIMEFRAME_CRYPTO_UPDATED");
    return state;
  }
  
  function applyMultiTimeframeCryptoToSignals(cryptoSignals = []) {
    return cryptoSignals.map((signal) => {
      const phase51 = calculateMultiTimeframeCrypto(signal);
      signal.phase51MultiTimeframeCrypto = phase51;
      signal.multiTimeframeCryptoScore = phase51.finalParliamentScore;
      signal.multiTimeframeCryptoDecision = phase51.parliamentDecision;
      signal.shortFrameCryptoScore = phase51.shortFrameScore;
      signal.midFrameCryptoScore = phase51.midFrameScore;
      signal.longFrameCryptoScore = phase51.longFrameScore;
      const continuationMemory =
        engineState.multiTimeframeCryptoMemory?.[normalizeSymbol(signal.symbol)];
      if (continuationMemory) {
        signal.continuationScorecard = {
          score: Number(continuationMemory.score ?? 50),
          available: continuationMemory.available === true,
          coverage: Number(continuationMemory.coverage || 0),
          tier: continuationMemory.tier,
          source: continuationMemory.source || "persisted_crypto_daily_sessions",
          observedSessions: Number(continuationMemory.observedSessions || 0),
        };
        signal.multiDayContinuationScore = signal.continuationScorecard.score;
        signal.multiDayContinuationTier = signal.continuationScorecard.tier;
        signal.multiDayAccumulation = {
          ...(signal.multiDayAccumulation || {}),
          seenDays: Array.isArray(continuationMemory.seenDays)
            ? continuationMemory.seenDays
            : [],
          seenDaysCount: Number(continuationMemory.observedSessions || 0),
        };
        signal.cryptoScoreTelemetry = {
          ...(signal.cryptoScoreTelemetry || {}),
          continuation: signal.continuationScorecard,
        };
      }
      if (phase51.blockTimeframeConflict) {
        signal.qualifiedToBuy = false;
        signal.phase51Suppressed = true;
        signal.phase51SuppressionReason = phase51.reason;
        recordCryptoScoreObservation(signal, "phase51", -8, "timeframe conflict");
      }
      if (phase51.parliamentDecision === "FULL_TIMEFRAME_ALIGNMENT") {
        recordCryptoScoreObservation(signal, "phase51", 6, "full timeframe alignment");
        signal.fullCryptoTimeframeAlignment = true;
      }
      if (phase51.parliamentDecision === "STRONG_TIMEFRAME_ALIGNMENT") {
        recordCryptoScoreObservation(signal, "phase51", 3, "strong timeframe alignment");
        signal.strongCryptoTimeframeAlignment = true;
      }
      if (phase51.parliamentDecision === "WAIT_FOR_TIMEFRAME_CONFIRMATION") {
        recordCryptoScoreObservation(signal, "phase51", -3, "wait for timeframe confirmation");
        signal.waitForCryptoTimeframeConfirmation = true;
      }
      return signal;
    });
  }
  
  function calculateCryptoReinforcementLearning(cryptoSignals = []) {
    const signals = Array.isArray(cryptoSignals) ? cryptoSignals : [];
    const closedTrades = Array.isArray(engineState.tradeJournalHistory)
      ? engineState.tradeJournalHistory
      : [];
    const cryptoTrades = closedTrades.filter((trade) => {
      const assetClass = String(trade.assetClass || "").toLowerCase();
      const symbol = normalizeSymbol(trade.symbol);
      return (
        assetClass === "crypto" ||
        symbol.endsWith("USD") ||
        symbol.includes("/")
      );
    });
    const strategyMemory = {};
    const symbolMemory = {};
    for (const trade of cryptoTrades.slice(0, 300)) {
      const symbol = normalizeSymbol(trade.symbol);
      const strategy =
        trade.strategy ||
        trade.selectedCryptoStrategy ||
        trade.entryType ||
        "UNKNOWN_CRYPTO_STRATEGY";
      const profitPercent = Number(trade.profitPercent || 0);
      if (!strategyMemory[strategy]) {
        strategyMemory[strategy] = {
          strategy,
          trades: 0,
          wins: 0,
          losses: 0,
          totalProfitPercent: 0,
          averageProfitPercent: 0,
          winRate: 0,
          trustScore: 50,
        };
      }
      strategyMemory[strategy].trades += 1;
      strategyMemory[strategy].totalProfitPercent += profitPercent;
      if (profitPercent > 0) {
        strategyMemory[strategy].wins += 1;
      } else if (profitPercent < 0) {
        strategyMemory[strategy].losses += 1;
      }
      strategyMemory[strategy].averageProfitPercent =
        strategyMemory[strategy].totalProfitPercent /
        Math.max(1, strategyMemory[strategy].trades);
      strategyMemory[strategy].winRate =
        (strategyMemory[strategy].wins /
          Math.max(1, strategyMemory[strategy].trades)) *
        100;
      strategyMemory[strategy].trustScore = clampScore(
        45 +
        strategyMemory[strategy].winRate * 0.35 +
        strategyMemory[strategy].averageProfitPercent * 3 -
        strategyMemory[strategy].losses * 1.5
      );
      if (!symbolMemory[symbol]) {
        symbolMemory[symbol] = {
          symbol,
          trades: 0,
          wins: 0,
          losses: 0,
          totalProfitPercent: 0,
          averageProfitPercent: 0,
          winRate: 0,
          trustScore: 50,
        };
      }
      symbolMemory[symbol].trades += 1;
      symbolMemory[symbol].totalProfitPercent += profitPercent;
      if (profitPercent > 0) {
        symbolMemory[symbol].wins += 1;
      } else if (profitPercent < 0) {
        symbolMemory[symbol].losses += 1;
      }
      symbolMemory[symbol].averageProfitPercent =
        symbolMemory[symbol].totalProfitPercent /
        Math.max(1, symbolMemory[symbol].trades);
      symbolMemory[symbol].winRate =
        (symbolMemory[symbol].wins /
          Math.max(1, symbolMemory[symbol].trades)) *
        100;
      symbolMemory[symbol].trustScore = clampScore(
        45 +
        symbolMemory[symbol].winRate * 0.35 +
        symbolMemory[symbol].averageProfitPercent * 3 -
        symbolMemory[symbol].losses * 2
      );
    }
    const reinforcedSignals = signals.map((signal) => {
      const symbol = normalizeSymbol(signal.symbol);
      const selectedStrategy =
        signal.selectedCryptoStrategy ||
        signal.autonomousCryptoStrategySelector?.selectedStrategy ||
        "UNKNOWN_CRYPTO_STRATEGY";
      const strategyTrust =
        strategyMemory[selectedStrategy]?.trustScore ?? 50;
      const symbolTrust = symbolMemory[symbol]?.trustScore ?? 50;
      const strategySampleSize = Number(
        strategyMemory[selectedStrategy]?.trades || 0
      );
      const symbolSampleSize = Number(symbolMemory[symbol]?.trades || 0);
      const learningSampleSize = Math.max(strategySampleSize, symbolSampleSize);
      const learningAvailable = learningSampleSize > 0;
      const selectorConfidence = Number(
        signal.cryptoStrategySelectorScore ||
        signal.autonomousCryptoStrategySelector?.strategyConfidence ||
        signal.score ||
        50
      );
      const reinforcementScore = clampScore(
        selectorConfidence * 0.45 +
        strategyTrust * 0.3 +
        symbolTrust * 0.25
      );
      const learningAdjustment = !learningAvailable
        ? 0
        : reinforcementScore >= 82
          ? 5
          : reinforcementScore >= 72
            ? 3
            : reinforcementScore <= 38
              ? -6
              : reinforcementScore <= 48
                ? -3
                : 0;
      const action = !learningAvailable
        ? "OBSERVE_NO_CRYPTO_HISTORY"
        : reinforcementScore >= 82
          ? "REINFORCE_CRYPTO_AGGRESSIVELY"
          : reinforcementScore >= 72
            ? "REINFORCE_CRYPTO_SELECTIVELY"
            : reinforcementScore <= 38
              ? "SUPPRESS_CRYPTO_SETUP"
              : "OBSERVE_CRYPTO_SETUP";
      return {
        symbol,
        selectedStrategy,
        reinforcementScore,
        strategyTrust,
        symbolTrust,
        strategySampleSize,
        symbolSampleSize,
        learningSampleSize,
        learningAvailable,
        learningAdjustment,
        action,
        shouldSuppressCrypto:
          learningAvailable && action === "SUPPRESS_CRYPTO_SETUP",
        shouldBoostCrypto:
          learningAvailable && (
            action === "REINFORCE_CRYPTO_AGGRESSIVELY" ||
            action === "REINFORCE_CRYPTO_SELECTIVELY"
          ),
        reason: "APPLIED",
      };
    });
    return {
      updatedAt: new Date().toISOString(),
      phase: "53_CRYPTO_REINFORCEMENT_LEARNING_EXPANSION",
      reviewedCryptoSignals: signals.length,
      learnedCryptoTrades: cryptoTrades.length,
      strategyMemory,
      symbolMemory,
      reinforcedSignals,
      topReinforcedCryptoSignals: reinforcedSignals
        .filter((item) => item.shouldBoostCrypto)
        .sort(
          (a, b) =>
            Number(b.reinforcementScore || 0) -
            Number(a.reinforcementScore || 0)
        )
        .slice(0, 10),
      suppressedCryptoSignals: reinforcedSignals
        .filter((item) => item.shouldSuppressCrypto)
        .slice(0, 20),
    };
  }
  
  function calculateCryptoStrategySelector(cryptoSignals = []) {
    return calculateCryptoStrategySelection(cryptoSignals, { normalizeSymbol, clampScore });
  }

  return {
    calculateCryptoInstitutionalSignal,
    updateCryptoInstitutionalState,
    calculateCryptoCapitalRotation,
    applyCryptoCapitalRotationToSignals,
    calculateCryptoExecutionTiming,
    updateCryptoExecutionTimingState,
    applyCryptoExecutionTimingToSignals,
    calculateCryptoPositionSizing,
    updateCryptoPositionSizingState,
    applyCryptoPositionSizingToSignals,
    calculateCryptoExitStrategy,
    updateCryptoExitStrategyState,
    applyCryptoExitStrategyToSignals,
    calculateCryptoLiquiditySweep,
    updateCryptoLiquiditySweepState,
    applyCryptoLiquiditySweepToSignals,
    calculateCrossMarketCorrelation,
    applyCrossMarketCorrelationToSignals,
    calculateStablecoinFlowPressure,
    applyStablecoinFlowToSignals,
    calculateWhaleSmartMoney,
    updateWhaleSmartMoneyState,
    applyWhaleSmartMoneyToSignals,
    calculateMultiTimeframeCrypto,
    updateMultiTimeframeCryptoState,
    applyMultiTimeframeCryptoToSignals,
    calculateCryptoReinforcementLearning,
    calculateCryptoStrategySelector,
  };
}
