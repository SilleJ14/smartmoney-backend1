const clamp = (value) => Math.max(0, Math.min(100, Number(value) || 0));

function component(name, value, weight, source, available = true) {
  const normalized = clamp(value);
  return {
    name,
    source,
    available: Boolean(available),
    value: Number(normalized.toFixed(2)),
    weight,
    contribution: Number((normalized * weight).toFixed(2)),
  };
}

function scorecard(stage, components, gates = []) {
  const available = components.filter((item) => item.available);
  const availableWeight = available.reduce((sum, item) => sum + item.weight, 0);
  const score = availableWeight > 0
    ? clamp(available.reduce((sum, item) => sum + item.contribution, 0) / availableWeight)
    : 0;
  return {
    stage,
    score: Number(score.toFixed(2)),
    components,
    gates,
    coverage: Number(availableWeight.toFixed(2)),
    missingComponents: components.filter((item) => !item.available).map((item) => item.name),
  };
}

function firstFinite(...values) {
  return values.find((value) => Number.isFinite(Number(value)));
}

export function calculateEarlyDiscoveryScore(signal = {}) {
  const confirmations = signal.confirmations || {};
  const preMove = firstFinite(signal.preMoveScore, signal.preMoverDiscovery?.preMoveScore);
  const accumulation = firstFinite(
    signal.accumulationIntelligence?.accumulationScore,
    signal.preMoverAccumulationScore,
    signal.multiDayAccumulation?.preBreakoutScore
  );
  const relativeVolume = firstFinite(
    signal.relativeVolume,
    signal.volumeRatio,
    signal.volumeSpikeRatio,
    confirmations.volumeSpikeRatio
  );
  const percentChange = Number(signal.percentChange || 0);
  const acceleration = clamp(45 + Math.min(Math.max(percentChange, -5), 15) * 3.2);
  const participation = clamp(Number(relativeVolume || 0) * 32);
  const catalyst = firstFinite(
    signal.catalystRanking?.catalystScore,
    signal.catalystScore,
    signal.newsCatalystScore
  );
  const components = [
    component("preMoveStructure", preMove, 0.28, "preMoveScore", preMove !== undefined),
    component("unusualParticipation", participation, 0.24, "relativeVolume", relativeVolume !== undefined),
    component("earlyAcceleration", acceleration, 0.2, "percentChange"),
    component("accumulation", accumulation, 0.18, "accumulationScore", accumulation !== undefined),
    component("catalystNovelty", catalyst, 0.1, "catalystScore", catalyst !== undefined),
  ];
  const card = scorecard("EARLY_DISCOVERY", components);
  return {
    ...card,
    tier: card.score >= 85 ? "ELITE_DISCOVERY" : card.score >= 72 ? "STRONG_DISCOVERY" : card.score >= 58 ? "DEVELOPING_DISCOVERY" : "LOW_DISCOVERY",
  };
}

export function calculateEntryQualityScore(signal = {}) {
  const confirmations = signal.confirmations || {};
  const technicals = signal.technicals || {};
  const quality = signal.phase5SignalQuality || signal.institutionalSignalQuality || {};
  const profile = signal.runnerStageProfile || {};
  const closeNearHigh = firstFinite(confirmations.closeNearHighPercent, profile.closeNearHighPercent);
  const rsi = Number(technicals.rsi || 50);
  const trendAlignment = clamp(
    35 +
    (Number(technicals.ema9 || 0) > Number(technicals.ema20 || 0) ? 30 : 0) +
    (Number(technicals.macd || 0) > Number(technicals.macdSignal || 0) ? 20 : 0) +
    (rsi >= 45 && rsi <= 72 ? 15 : rsi > 82 ? -25 : 0)
  );
  const priceLocation = clamp(
    Number(closeNearHigh ?? 50) - Number(quality.vwapExtensionPenalty || 0) * 0.45 - Number(quality.candleRejectionRisk || 0) * 0.25
  );
  const setupConfirmation = clamp(
    30 + (confirmations.aboveVwap ? 25 : 0) + (quality.breakoutRetestConfirmation ? 30 : 0) + (!confirmations.fakeBreakout ? 15 : -40)
  );
  const liquidity = firstFinite(quality.liquidityStabilityScore, signal.liquidityStabilityScore);
  const riskProtection = clamp(100 - Math.max(
    Number(quality.antiChaseRisk || signal.antiChaseRisk || 0),
    Number(quality.exhaustionRisk || signal.exhaustionRisk || 0),
    Number(quality.spreadWideningRisk || 0)
  ));
  const hardReject = quality.hardReject === true || confirmations.newsRisk === true || signal.lateChaseRisk === true;
  const components = [
    component("trendAlignment", trendAlignment, 0.23, "ema_macd_rsi"),
    component("priceLocation", priceLocation, 0.22, "close_vwap_rejection", closeNearHigh !== undefined),
    component("setupConfirmation", setupConfirmation, 0.22, "vwap_retest_breakout"),
    component("liquidityExecution", liquidity, 0.18, "liquidityStabilityScore", liquidity !== undefined),
    component("riskProtection", riskProtection, 0.15, "max_independent_risk"),
  ];
  const card = scorecard("ENTRY_QUALITY", components, hardReject ? ["HARD_RISK_REJECT"] : []);
  const score = hardReject ? Math.min(card.score, 35) : card.score;
  return {
    ...card,
    score: Number(score.toFixed(2)),
    approved: !hardReject && score >= 72,
    tier: hardReject ? "BLOCKED" : score >= 85 ? "ELITE_ENTRY" : score >= 72 ? "GOOD_ENTRY" : score >= 60 ? "WAIT_FOR_ENTRY" : "POOR_ENTRY",
  };
}

export function calculateMultiDayContinuationScore(signal = {}) {
  const memory = signal.multiDayAccumulation || {};
  const confirmations = signal.confirmations || {};
  const seenDays = Array.isArray(memory.seenDays) ? memory.seenDays.length : Number(memory.seenDaysCount || 0);
  const persistence = firstFinite(memory.persistenceScore, signal.persistenceScore);
  const support = firstFinite(memory.supportHoldingScore, signal.runnerHoldScore);
  const sessionEvidence = clamp(seenDays * 20);
  const trendDurability = clamp(
    45 + (confirmations.aboveVwap ? 20 : 0) + (Number(signal.technicals?.ema9 || 0) > Number(signal.technicals?.ema20 || 0) ? 20 : 0) + (confirmations.closeNearHigh ? 15 : 0)
  );
  const exhaustion = Math.max(
    Number(signal.exhaustionRisk || signal.phase5SignalQuality?.exhaustionRisk || 0),
    Number(signal.lateChaseRisk ? 100 : 0),
    Number(confirmations.fakeBreakout ? 90 : 0)
  );
  const components = [
    component("observedPersistence", persistence, 0.3, "multiDayMemory.persistence", persistence !== undefined),
    component("supportRetention", support, 0.24, "multiDayMemory.support", support !== undefined),
    component("multiSessionEvidence", sessionEvidence, 0.18, "multiDayMemory.seenDays", seenDays > 0),
    component("trendDurability", trendDurability, 0.18, "trend_support"),
    component("exhaustionResistance", 100 - exhaustion, 0.1, "max_exhaustion_risk"),
  ];
  const card = scorecard("MULTI_DAY_CONTINUATION", components);
  const coverageAdjustedScore = clamp(card.score * card.coverage);
  return {
    ...card,
    score: Number(coverageAdjustedScore.toFixed(2)),
    tier: coverageAdjustedScore >= 85 ? "ELITE_CONTINUATION" : coverageAdjustedScore >= 72 ? "STRONG_CONTINUATION" : coverageAdjustedScore >= 60 ? "POSSIBLE_CONTINUATION" : "INTRADAY_ONLY",
  };
}

export function buildDecisionScoreTelemetry(signal = {}) {
  const discovery = signal.discoveryScorecard || calculateEarlyDiscoveryScore(signal);
  const entry = signal.entryQualityScorecard || calculateEntryQualityScore(signal);
  const continuation = signal.continuationScorecard || calculateMultiDayContinuationScore(signal);
  return {
    version: 1,
    calculatedAt: new Date().toISOString(),
    scores: { discovery: discovery.score, entry: entry.score, continuation: continuation.score },
    stages: { discovery, entry, continuation },
  };
}
