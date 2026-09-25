// Canonical buy permission is composed here. Legacy phases may record that
// they would have blocked. They do not flip this result.

export function composeCanonicalDecision({
  analytical = "PASS",
  analyticalReason = null,
  authorization = "PASS",
  authorizationReason = null,
  C = "PASS",
  cReason = null,
  X = "PASS",
  xReason = null,
  R = "PASS",
  rReason = null,
  S = 0,
  sReason = null,
  legacyVetoes = {},
} = {}) {
  const blockingLayers = [];
  if (analytical !== "PASS") blockingLayers.push({ layer: "ANALYTICAL", reason: analyticalReason || "ANALYTICAL_NOT_PASS" });
  if (authorization !== "PASS") blockingLayers.push({ layer: "AUTHORIZATION", reason: authorizationReason || "AUTHORIZATION_NOT_PASS" });
  if (C !== "PASS") blockingLayers.push({ layer: "C", reason: cReason || "DATA_NOT_PASS" });
  if (X !== "PASS" && X !== "PASS_WITH_CONSTRAINT") blockingLayers.push({ layer: "X", reason: xReason || "EXECUTION_NOT_READY" });
  if (R !== "PASS" && R !== "PASS_WITH_CONSTRAINT") blockingLayers.push({ layer: "R", reason: rReason || "RISK_NOT_PASS" });
  if (!(Number(S) > 0)) blockingLayers.push({ layer: "S", reason: sReason || "POSITION_SIZE_ZERO" });
  return {
    buyable: blockingLayers.length === 0,
    blockingLayers,
    legacyVetoes,
    legacyMayFlipBuyable: false,
  };
}

export function canonicalRiskAssessment({
  dailyLoss = false,
  crash = false,
  equityMacroStress = false,
  portfolioHeat = false,
} = {}) {
  const reasons = [];
  if (dailyLoss) reasons.push("DAILY_LOSS_LIMIT");
  if (crash) reasons.push("CRASH_REGIME");
  if (equityMacroStress) reasons.push("EQUITY_MACRO_STRESS");
  if (portfolioHeat) reasons.push("PORTFOLIO_HEAT");
  const blocking = reasons.includes("DAILY_LOSS_LIMIT") || reasons.includes("CRASH_REGIME");
  return {
    state: blocking ? "REJECT" : reasons.length ? "PASS_WITH_CONSTRAINT" : "PASS",
    reasons,
    affectsF: false,
    duplicatePhaseVetoes: false,
  };
}

export function cryptoRiskEvidence({
  equityMacroStress = false,
  crash = false,
  cryptoMarketRegime = null,
  btcRegime = null,
} = {}) {
  const risk = canonicalRiskAssessment({ equityMacroStress, crash });
  return {
    hiddenMacroPass: false,
    affectsF: false,
    R: {
      ...risk,
      equityMacroStress: equityMacroStress ? "STRESSED" : "CLEAR",
      cryptoMarketRegime,
      btcRegime,
    },
  };
}

export function buildLegacyVetoShadow(signal = {}) {
  const phase59 = signal.phase59InstitutionalOrderFlow?.shouldBlock === true;
  const phase60 = signal.phase60AdaptiveExecution?.shouldBlock === true;
  const phase61 = signal.phase61ProfitAggression?.shouldBlockAggression === true;
  const phase62 = signal.phase62MarketPersonality?.shouldPersonalityBlock === true;
  const phase63 = signal.phase63StrategyEvolution?.shouldStrategyBlock === true;
  return {
    mode: "SHADOW_ADVISORY",
    mayChangeCanonicalBuyable: false,
    legacyPhase7WouldBlock: signal.phase7Suppressed === true,
    legacyPhase9WouldBlock: signal.phase9LiquiditySuppressed === true || signal.phase9LiquidityIntelligence?.liquidityLabel === "WEAK_LIQUIDITY_TRAP",
    legacyPhase11WouldBlock: signal.phase11Suppressed === true,
    legacyPhase12WouldBlock: signal.phase12Suppressed === true,
    legacyPhase13WouldBlock: signal.phase13Suppressed === true,
    legacyPhase14WouldBlock: signal.phase14Suppressed === true,
    legacyPhase15WouldBlock: signal.phase15ExecutionBlocked === true,
    legacyPhase59WouldBlock: phase59,
    legacyPhase60WouldBlock: phase60,
    legacyPhase61WouldBlock: phase61,
    legacyPhase62WouldBlock: phase62,
    legacyPhase63WouldBlock: phase63,
    classifiedAs: {
      phase7: "STRATEGY_ADVISORY",
      phase9: "EXECUTION_EVIDENCE",
      phase11: "STRATEGY_ADVISORY",
      phase12: "RISK_EVIDENCE",
      phase13: "SIZE_RECOMMENDATION",
      phase14: "RISK_EVIDENCE",
      phase15: "EXECUTION_EVIDENCE",
      phase59: "EXECUTION_EVIDENCE",
      phase60: "EXECUTION_EVIDENCE",
      phase61: "SIZE_RECOMMENDATION",
      phase62: "DIAGNOSTIC_ONLY",
      phase63: "STRATEGY_ADVISORY",
    },
  };
}
