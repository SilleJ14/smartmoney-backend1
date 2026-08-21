export function calculateTrendQualityHoldDuration(signal = {}, clampScore) {
  const score = Number(signal.score || 0);
  const technicalScore = Number(signal.technicalScore || 0);
  const statisticalScore = Number(signal.statisticalScore || 0);
  const trendPersistenceScore = Number(signal.trendPersistenceScore || 0);
  const unrealizedPercent = Number(signal.unrealizedPercent || 0);
  const dropFromHigh = Number(signal.dropFromHigh || 0);
  const trendQualityScore = clampScore(
    score * 0.3 + technicalScore * 0.25 + statisticalScore * 0.2 + trendPersistenceScore * 0.25
  );
  const holdMode = trendQualityScore >= 80 && unrealizedPercent > 0 && dropFromHigh <= 2
    ? "EXTENDED_SWING_HOLD"
    : trendQualityScore >= 65 && dropFromHigh <= 1.5
      ? "NORMAL_SWING_HOLD"
      : "STANDARD_EXIT_RULES";
  return {
    trendQualityScore,
    holdMode,
    suggestedHoldDays: holdMode === "EXTENDED_SWING_HOLD" ? 5 : holdMode === "NORMAL_SWING_HOLD" ? 3 : 1,
    shouldExtendHold: holdMode !== "STANDARD_EXIT_RULES",
  };
}

export function calculateExitParliamentConsensus(input = {}, { normalizeSymbol, clampScore }) {
  const {
    symbol, unrealizedPercent = 0, dropFromHigh = 0, shouldStopLoss = false,
    shouldProtectProfit = false, shouldNormalTrailingExit = false,
    shouldRunnerTrailingExit = false, smartExitDecision = {},
    institutionalExitDecision = {}, distributionClimaxDecision = {},
    adaptiveOvernightHoldDecision = {}, smartSwingConversionDecision = {},
    explosiveRunnerHoldDecision = {}, phase7Reinforcement = {},
  } = input;
  const exitVotes = [];
  const holdVotes = [];
  const trimVotes = [];
  if (shouldStopLoss) exitVotes.push("STOP_LOSS");
  if (shouldProtectProfit) exitVotes.push("PROFIT_PROTECTION");
  if (shouldNormalTrailingExit) exitVotes.push("TRAILING_STOP");
  if (shouldRunnerTrailingExit) exitVotes.push("RUNNER_TRAILING_STOP");
  if (smartExitDecision.shouldForceExit) exitVotes.push("SMART_EXIT");
  if (institutionalExitDecision.shouldForceExit) exitVotes.push("INSTITUTIONAL_EXIT");
  if (distributionClimaxDecision.shouldExitClimax) exitVotes.push("CLIMAX_EXIT");
  if (adaptiveOvernightHoldDecision.shouldExitBeforeClose) exitVotes.push("OVERNIGHT_RISK_EXIT");
  if (smartExitDecision.shouldExtendHold) holdVotes.push("SMART_EXTEND_HOLD");
  if (institutionalExitDecision.shouldHold) holdVotes.push("INSTITUTIONAL_HOLD");
  if (adaptiveOvernightHoldDecision.shouldHoldOvernight) holdVotes.push("OVERNIGHT_HOLD");
  if (smartSwingConversionDecision.shouldProtectSwing) holdVotes.push("SWING_CONVERSION_HOLD");
  if (explosiveRunnerHoldDecision.shouldHold) holdVotes.push("EXPLOSIVE_RUNNER_HOLD");
  if (unrealizedPercent >= 8 && dropFromHigh >= 1.2 && dropFromHigh <= 3.5 && !shouldStopLoss) {
    trimVotes.push("SMART_PARTIAL_TRIM");
  }
  const climaxTopDetected = Number(distributionClimaxDecision.distributionRiskScore || 0) >= 85 ||
    Number(distributionClimaxDecision.climaxScore || 0) >= 85;
  const institutionalDistributionDetected = distributionClimaxDecision.shouldExitClimax === true ||
    Number(distributionClimaxDecision.distributionRiskScore || 0) >= 75;
  const emergencyExit = shouldStopLoss || smartExitDecision.continuationFailure ||
    smartExitDecision.runnerFailure || climaxTopDetected;
  const trust = Number(phase7Reinforcement.setupTrustScore || 50);
  const exitScore = clampScore(exitVotes.length * 18 + (unrealizedPercent <= -2 ? 20 : 0) +
    (dropFromHigh >= 3 ? 18 : 0) + (institutionalDistributionDetected ? 18 : 0) +
    (climaxTopDetected ? 25 : 0) - (trust >= 75 ? 8 : 0));
  const holdScore = clampScore(holdVotes.length * 18 + (unrealizedPercent > 0 ? 10 : 0) +
    (smartSwingConversionDecision.swingConversionScore >= 75 ? 18 : 0) +
    (institutionalExitDecision.runnerProtectionScore >= 70 ? 15 : 0) +
    (explosiveRunnerHoldDecision.shouldHold ? 22 : 0) + (trust >= 75 ? 10 : 0));
  const trimScore = clampScore(trimVotes.length * 22 + (unrealizedPercent >= 10 ? 15 : 0) +
    (dropFromHigh >= 1.5 && dropFromHigh <= 4 ? 12 : 0) -
    (explosiveRunnerHoldDecision.shouldHold ? 8 : 0));
  const shouldPartialTrim = !emergencyExit && trimScore >= 35 && holdScore >= exitScore - 10;
  const shouldConsensusExit = emergencyExit || exitScore >= holdScore + 15;
  const shouldConsensusHold = !emergencyExit && !shouldPartialTrim && holdScore > exitScore;
  return {
    symbol: normalizeSymbol(symbol), phase: "8_INSTITUTIONAL_EXIT_PARLIAMENT_V2",
    parliamentMode: emergencyExit ? "EMERGENCY_EXIT_APPROVED" : shouldConsensusExit
      ? "CONSENSUS_EXIT" : shouldPartialTrim ? "PARTIAL_TRIM_APPROVED"
        : shouldConsensusHold ? "CONSENSUS_HOLD" : "MIXED_EXIT_SIGNALS",
    exitScore, holdScore, trimScore, exitVotes, holdVotes, trimVotes, emergencyExit,
    climaxTopDetected, institutionalDistributionDetected, shouldConsensusExit,
    shouldConsensusHold, shouldPartialTrim, reason: "STATE_UPDATED",
  };
}

export function calculateTrendPersistenceHoldDecision(input = {}, runnerTrailingStopPercent = 3) {
  const { unrealizedPercent = 0, dropFromHigh = 0, isRunner = false, highWater = 0, currentPrice = 0 } = input;
  const priceStillNearHigh = highWater > 0 && currentPrice > 0 && currentPrice >= highWater * 0.985;
  if (isRunner && unrealizedPercent >= 4 && dropFromHigh <= 2.5 && priceStillNearHigh) {
    return { shouldHold: true, mode: "STRONG_TREND_HOLD", runnerTrailingStopPercent: 1.5,
      reason: "Runner trend remains healthy. Avoiding premature exit." };
  }
  return { shouldHold: false, mode: "NORMAL_EXIT_RULES", runnerTrailingStopPercent,
    reason: "Normal exit rules apply." };
}

export function calculateCoreExitTriggers({
  unrealizedPercent = 0,
  dropFromHigh = 0,
  isRunner = false,
  stopLossPercent = -2,
  trailingStopPercent = -2,
  runnerTrailingStopPercent = 3,
  explosiveRunnerHold = false,
} = {}) {
  return {
    shouldStopLoss: unrealizedPercent <= Number(stopLossPercent),
    shouldProtectProfit: unrealizedPercent >= 2 && dropFromHigh >= 0.8,
    shouldNormalTrailingExit:
      !isRunner && unrealizedPercent > 0 && dropFromHigh >= Math.abs(Number(trailingStopPercent)),
    shouldRunnerTrailingExit:
      isRunner && !explosiveRunnerHold && dropFromHigh >= Number(runnerTrailingStopPercent),
  };
}
