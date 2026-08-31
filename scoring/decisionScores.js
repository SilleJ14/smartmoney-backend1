import { isUsStockMarketSessionDayKey } from "../utils/usMarketCalendar.js";

const clamp = (value) => Math.max(0, Math.min(100, Number(value) || 0));

function component(name, value, weight, source, available = true) {
  const normalized = clamp(value);
  return {
    name,
    source,
    available: Boolean(available),
    value: Number(normalized.toFixed(2)),
    weight,
    normalizedWeight: 0,
    effectiveWeight: 0,
    contribution: 0,
  };
}

function scorecard(stage, components, gates = []) {
  const available = components.filter((item) => item.available);
  const configuredWeight = components.reduce((sum, item) => sum + item.weight, 0);
  const availableWeight = available.reduce((sum, item) => sum + item.weight, 0);
  const normalizedComponents = components.map((item) => {
    const normalizedWeight = item.available && availableWeight > 0 ? item.weight / availableWeight : 0;
    return {
      ...item,
      normalizedWeight: Number(normalizedWeight.toFixed(4)),
      effectiveWeight: Number(normalizedWeight.toFixed(4)),
      contribution: Number((item.value * normalizedWeight).toFixed(2)),
    };
  });
  const score = clamp(normalizedComponents.reduce((sum, item) => sum + item.contribution, 0));
  return {
    stage,
    score: Number(score.toFixed(2)),
    rawScore: Number(score.toFixed(2)),
    components: normalizedComponents,
    gates,
    coverage: Number((configuredWeight > 0 ? availableWeight / configuredWeight : 0).toFixed(2)),
    missingComponents: components.filter((item) => !item.available).map((item) => item.name),
  };
}

function rescaleScorecard(card, nextScore) {
  const score = clamp(nextScore);
  const scale = card.score > 0 ? score / card.score : 0;
  return {
    ...card,
    score: Number(score.toFixed(2)),
    components: card.components.map((item) => ({
      ...item,
      effectiveWeight: Number((item.effectiveWeight * scale).toFixed(4)),
      contribution: Number((item.contribution * scale).toFixed(2)),
    })),
  };
}

function firstFinite(...values) {
  return values.find((value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value)));
}

function resolveMeasuredStockSpread(signal = {}, quality = {}) {
  const liveBid = firstFinite(signal.liveQuote?.bid);
  const liveAsk = firstFinite(signal.liveQuote?.ask);
  if (
    Number(liveBid || 0) > 0 &&
    Number(liveAsk || 0) >= Number(liveBid || 0)
  ) {
    return {
      spreadPercent:
        ((Number(liveAsk) - Number(liveBid)) /
          ((Number(liveAsk) + Number(liveBid)) / 2)) * 100,
      source: "live_quote_bid_ask",
    };
  }

  const bid = firstFinite(signal.bid);
  const ask = firstFinite(signal.ask);
  if (Number(bid || 0) > 0 && Number(ask || 0) >= Number(bid || 0)) {
    return {
      spreadPercent:
        ((Number(ask) - Number(bid)) /
          ((Number(ask) + Number(bid)) / 2)) * 100,
      source: "signal_bid_ask",
    };
  }

  const directSpread = firstFinite(
    signal.spreadPercent,
    quality.spreadPercent,
    signal.institutionalSignalQuality?.spreadPercent
  );
  return Number(directSpread) >= 0
    ? { spreadPercent: Number(directSpread), source: "reported_spread_fallback" }
    : { spreadPercent: null, source: "unavailable" };
}

function resolveRiskQualityEvidence(signal = {}) {
  const directRiskQuality = firstFinite(
    signal.blendedRiskScore,
    signal.riskScore,
    signal.institutionalRiskScore
  );
  if (directRiskQuality !== undefined) {
    return {
      score: clamp(directRiskQuality),
      source: signal.blendedRiskScore !== undefined
        ? "blendedRiskScore"
        : signal.riskScore !== undefined
          ? "riskScore"
          : "institutionalRiskScore",
    };
  }
  const riskPortfolioComponent = [
    ...(signal.decisionScoreTelemetry?.stages?.decision?.components || []),
    ...(signal.centralAutonomousDecisionCore?.scoreComponents || []),
  ].find((item) => item?.name === "riskPortfolio" && item.available !== false);
  const fallback = firstFinite(
    signal.riskPortfolioScore,
    riskPortfolioComponent?.value
  );
  return fallback === undefined
    ? { score: null, source: "unavailable" }
    : { score: clamp(fallback), source: "risk_portfolio_fallback" };
}

export const STOCK_DECISION_WEIGHTS = Object.freeze({
  discovery: 0.32,
  entry: 0.42,
  marketContext: 0.09,
  riskPortfolio: 0.09,
  fundamentals: 0.08,
});

export const STOCK_EXECUTION_THRESHOLDS = Object.freeze({
  watchlistScore: 60,
  qualifiedScore: 72,
  finalScore: 78,
  entryScore: 75,
  entryCoverage: 0.8,
  acceleratedFinalScore: 85,
  acceleratedEntryScore: 82,
  maxSpreadPercent: 1,
  maxQuoteAgeSeconds: 15,
  maxDecisionAgeSeconds: 300,
  riskQualityScore: 55,
});

export function evaluateStockTradeCandidate(
  signal = {},
  {
    requireCentralDecision = false,
    requireFreshDecision = false,
    maxSpreadPercent = STOCK_EXECUTION_THRESHOLDS.maxSpreadPercent,
    maxQuoteAgeSeconds = STOCK_EXECUTION_THRESHOLDS.maxQuoteAgeSeconds,
    maxDecisionAgeSeconds = STOCK_EXECUTION_THRESHOLDS.maxDecisionAgeSeconds,
    now = Date.now(),
  } = {}
) {
  const parsedFinalScore = Number(
    signal.masterFinalScore ??
    signal.finalAutonomousDecisionScore ??
    signal.stockDecisionScore ??
    signal.score ??
    0
  );
  const finalScoreAvailable = Number.isFinite(parsedFinalScore);
  const finalScore = finalScoreAvailable ? parsedFinalScore : 0;
  const entryScore = Number(signal.entryQualityScore ?? signal.entryQualityScorecard?.score ?? 0);
  const entryCoverage = Number(signal.entryQualityScorecard?.coverage || 0);
  const decisionCoverage = Number(
    signal.decisionScoreCoverage ??
    signal.decisionScoreTelemetry?.stages?.decision?.coverage ??
    0
  );
  const entryApproved = signal.entryQualityScorecard?.approved === true;
  const discoveryCoverage = Number(
    signal.discoveryScorecard?.coverage ??
    signal.decisionScoreTelemetry?.stages?.discovery?.coverage ??
    signal.centralAutonomousDecisionCore?.stockDecisionEvidence?.discoveryCoverage ??
    0
  );
  const explicitCoreEvidence =
    signal.stockDecisionEvidence?.coreEvidencePass ??
    signal.centralAutonomousDecisionCore?.stockDecisionEvidence?.coreEvidencePass ??
    signal.decisionScoreTelemetry?.stages?.decision?.coreEvidencePass;
  const coreEvidencePass = explicitCoreEvidence === undefined
    ? discoveryCoverage >= 0.65 && entryCoverage >= STOCK_EXECUTION_THRESHOLDS.entryCoverage && decisionCoverage >= STOCK_EXECUTION_THRESHOLDS.entryCoverage
    : explicitCoreEvidence === true;
  const centralAction = String(
    signal.centralAutonomousAction ??
    signal.centralAutonomousDecisionCore?.action ??
    signal.finalMasterDecisionProfile?.action ??
    ""
  ).toUpperCase();
  const centralDecisionPass = !requireCentralDecision || [
    "ALLOW",
    "ALLOW_REDUCED_SIZE",
    "ACCELERATE_CAPITAL",
  ].includes(centralAction);
  const spreadEvidence = resolveMeasuredStockSpread(
    signal,
    signal.phase5SignalQuality || signal.institutionalSignalQuality || {}
  );
  const calculatedSpread = spreadEvidence.spreadPercent;
  const spreadAvailable = calculatedSpread !== null && Number.isFinite(calculatedSpread);
  const effectiveMaxSpread = Number.isFinite(Number(maxSpreadPercent))
    ? Math.min(
      STOCK_EXECUTION_THRESHOLDS.maxSpreadPercent,
      Math.max(0, Number(maxSpreadPercent))
    )
    : STOCK_EXECUTION_THRESHOLDS.maxSpreadPercent;
  const spreadTooWide =
    calculatedSpread !== null && calculatedSpread > effectiveMaxSpread;
  const riskQualityEvidence = resolveRiskQualityEvidence(signal);
  const riskQualityAvailable = riskQualityEvidence.score !== null;
  const riskQualityPass =
    riskQualityAvailable &&
    riskQualityEvidence.score >= STOCK_EXECUTION_THRESHOLDS.riskQualityScore;
  const quoteTimestampRaw =
    signal.liveQuote?.updatedAt ??
    signal.liveQuoteUpdatedAt ??
    signal.quoteFetchedAt;
  const quoteTimestamp = Number.isFinite(Number(quoteTimestampRaw))
    ? Number(quoteTimestampRaw)
    : quoteTimestampRaw
      ? Date.parse(quoteTimestampRaw)
      : NaN;
  const quoteAgeSeconds = Number.isFinite(quoteTimestamp)
    ? (Number(now) - quoteTimestamp) / 1000
    : null;
  const effectiveMaxQuoteAgeSeconds = Number.isFinite(Number(maxQuoteAgeSeconds))
    ? Math.max(1, Number(maxQuoteAgeSeconds))
    : STOCK_EXECUTION_THRESHOLDS.maxQuoteAgeSeconds;
  const quoteFreshnessAvailable = quoteAgeSeconds !== null;
  const quoteFreshnessPass = !requireCentralDecision || (
    quoteFreshnessAvailable &&
    quoteAgeSeconds >= -5 &&
    quoteAgeSeconds <= effectiveMaxQuoteAgeSeconds
  );
  const spreadTimestampRaw =
    signal.spreadUpdatedAt ??
    signal.bidAskUpdatedAt ??
    (spreadAvailable ? quoteTimestampRaw : null);
  const spreadTimestamp = Number.isFinite(Number(spreadTimestampRaw))
    ? Number(spreadTimestampRaw)
    : spreadTimestampRaw
      ? Date.parse(spreadTimestampRaw)
      : NaN;
  const spreadAgeSeconds = Number.isFinite(spreadTimestamp)
    ? (Number(now) - spreadTimestamp) / 1000
    : null;
  const spreadFreshnessAvailable = spreadAvailable && spreadAgeSeconds !== null;
  const spreadFreshnessPass = !requireCentralDecision || (
    spreadFreshnessAvailable &&
    spreadAgeSeconds >= -5 &&
    spreadAgeSeconds <= effectiveMaxQuoteAgeSeconds
  );
  const decisionTimestampRaw =
    signal.decisionUpdatedAt ??
    signal.decisionTimestamp ??
    signal.decisionScoreTelemetry?.calculatedAt ??
    signal.centralAutonomousDecisionCore?.updatedAt ??
    signal.finalMasterDecisionProfile?.updatedAt ??
    signal.scanCompletedAt ??
    signal.updatedAt;
  const decisionTimestamp = Number.isFinite(Number(decisionTimestampRaw))
    ? Number(decisionTimestampRaw)
    : decisionTimestampRaw
      ? Date.parse(decisionTimestampRaw)
      : NaN;
  const decisionAgeSeconds = Number.isFinite(decisionTimestamp)
    ? (Number(now) - decisionTimestamp) / 1000
    : null;
  const effectiveMaxDecisionAgeSeconds = Number.isFinite(Number(maxDecisionAgeSeconds))
    ? Math.max(1, Number(maxDecisionAgeSeconds))
    : STOCK_EXECUTION_THRESHOLDS.maxDecisionAgeSeconds;
  const decisionFreshnessAvailable = decisionAgeSeconds !== null;
  const decisionFreshnessPass = !requireFreshDecision || (
    decisionFreshnessAvailable &&
    decisionAgeSeconds >= -5 &&
    decisionAgeSeconds <= effectiveMaxDecisionAgeSeconds
  );
  const explicitBuyBlock =
    signal.blockBuying === true ||
    signal.buyBlocked === true ||
    signal.displayOnly === true ||
    signal.discoveryOnly === true ||
    signal.entryEvidenceBlocked === true ||
    signal.phase14Suppressed === true ||
    signal.phase7Suppressed === true ||
    signal.phase7Reinforcement?.suppressEntry === true ||
    signal.phase9LiquiditySuppressed === true ||
    signal.phase11Suppressed === true ||
    signal.phase12Suppressed === true ||
    signal.phase13Suppressed === true ||
    signal.phase15ExecutionBlocked === true ||
    signal.phase15ExecutionDominance?.blockExecution === true ||
    signal.unifiedInstitutionalOrchestrator?.shouldBlock === true ||
    signal.phase59InstitutionalOrderFlow?.shouldBlock === true ||
    signal.phase60AdaptiveExecution?.shouldBlockExecution === true ||
    signal.phase61ProfitAggression?.shouldBlockAggression === true ||
    signal.phase62MarketPersonality?.shouldPersonalityBlock === true ||
    signal.phase63StrategyEvolution?.shouldStrategyBlock === true ||
    signal.phase6ScoringLayers?.hardReject === true ||
    [
      "BLOCK",
      "REJECT_WEAK_TIMING",
      "WATCHLIST_WAIT_FOR_DATA",
    ].includes(String(
      signal.finalTradeApproval ||
      signal.phase6ScoringLayers?.finalTradeApproval ||
      ""
    ).toUpperCase());
  const blockingState =
    explicitBuyBlock ||
    signal.centralCoreHardBlock === true ||
    signal.finalMasterDecisionProfile?.suppressEntry === true ||
    signal.finalSizingReconciliation?.finalBlocked === true ||
    signal.confirmations?.fakeBreakout === true ||
    signal.confirmations?.newsRisk === true ||
    signal.globalRiskOffDefense?.shouldBlock === true ||
    signal.shouldWaitForPullback === true;
  const reasons = [
    ...(!entryApproved ? ["ENTRY_NOT_APPROVED"] : []),
    ...(entryScore < STOCK_EXECUTION_THRESHOLDS.entryScore ? ["ENTRY_SCORE_BELOW_75"] : []),
    ...(entryCoverage < STOCK_EXECUTION_THRESHOLDS.entryCoverage ? ["ENTRY_COVERAGE_BELOW_80_PERCENT"] : []),
    ...(decisionCoverage < STOCK_EXECUTION_THRESHOLDS.entryCoverage ? ["DECISION_COVERAGE_BELOW_80_PERCENT"] : []),
    ...(discoveryCoverage < 0.65 ? ["DISCOVERY_COVERAGE_BELOW_65_PERCENT"] : []),
    ...(!coreEvidencePass ? ["CORE_EVIDENCE_FAILED"] : []),
    ...(!centralDecisionPass ? ["CENTRAL_DECISION_NOT_EXECUTABLE"] : []),
    ...(explicitBuyBlock ? ["EXPLICIT_BUY_BLOCK"] : []),
    ...(!spreadAvailable ? ["SPREAD_UNAVAILABLE"] : []),
    ...(spreadTooWide ? ["SPREAD_ABOVE_EXECUTION_LIMIT"] : []),
    ...(!riskQualityAvailable ? ["RISK_QUALITY_UNAVAILABLE"] : []),
    ...(riskQualityAvailable && !riskQualityPass ? ["RISK_QUALITY_BELOW_55"] : []),
    ...(
      requireCentralDecision && !quoteFreshnessAvailable
        ? ["QUOTE_FRESHNESS_UNAVAILABLE"]
        : []
    ),
    ...(
      requireCentralDecision && quoteFreshnessAvailable && !quoteFreshnessPass
        ? ["QUOTE_STALE"]
        : []
    ),
    ...(
      requireCentralDecision && spreadAvailable && !spreadFreshnessAvailable
        ? ["SPREAD_FRESHNESS_UNAVAILABLE"]
        : []
    ),
    ...(
      requireCentralDecision && spreadFreshnessAvailable && !spreadFreshnessPass
        ? [spreadAgeSeconds < -5 ? "SPREAD_TIMESTAMP_IN_FUTURE" : "SPREAD_STALE"]
        : []
    ),
    ...(
      requireFreshDecision && !decisionFreshnessAvailable
        ? ["DECISION_FRESHNESS_UNAVAILABLE"]
        : []
    ),
    ...(
      requireFreshDecision && decisionFreshnessAvailable && !decisionFreshnessPass
        ? [decisionAgeSeconds < -5 ? "DECISION_TIMESTAMP_IN_FUTURE" : "DECISION_STALE"]
        : []
    ),
    ...(blockingState ? ["BLOCKING_RISK_STATE"] : []),
    ...(!finalScoreAvailable ? ["FINAL_SCORE_INVALID"] : []),
    ...(finalScore < STOCK_EXECUTION_THRESHOLDS.finalScore ? ["FINAL_SCORE_BELOW_78"] : []),
  ];
  return {
    watchlistEligible:
      finalScore >= STOCK_EXECUTION_THRESHOLDS.watchlistScore &&
      decisionCoverage >= STOCK_EXECUTION_THRESHOLDS.entryCoverage,
    qualifiedCandidate:
      finalScore >= STOCK_EXECUTION_THRESHOLDS.qualifiedScore &&
      decisionCoverage >= STOCK_EXECUTION_THRESHOLDS.entryCoverage &&
      entryCoverage >= STOCK_EXECUTION_THRESHOLDS.entryCoverage &&
      entryScore >= STOCK_EXECUTION_THRESHOLDS.entryScore &&
      entryApproved &&
      coreEvidencePass &&
      riskQualityPass &&
      quoteFreshnessPass &&
      spreadFreshnessPass &&
      decisionFreshnessPass &&
      finalScoreAvailable &&
      spreadAvailable &&
      !blockingState &&
      !spreadTooWide,
    approved: reasons.length === 0,
    accelerated:
      reasons.length === 0 &&
      finalScore >= STOCK_EXECUTION_THRESHOLDS.acceleratedFinalScore &&
      entryScore >= STOCK_EXECUTION_THRESHOLDS.acceleratedEntryScore,
    finalScore,
    finalScoreAvailable,
    entryScore,
    entryCoverage,
    decisionCoverage,
    discoveryCoverage,
    entryApproved,
    coreEvidencePass,
    centralAction: centralAction || null,
    centralDecisionPass,
    explicitBuyBlock,
    blockingState,
    spreadPercent: calculatedSpread,
    spreadAvailable,
    spreadSource: spreadEvidence.source,
    spreadTooWide,
    riskQualityScore: riskQualityEvidence.score,
    riskQualitySource: riskQualityEvidence.source,
    riskQualityPass,
    quoteTimestamp: Number.isFinite(quoteTimestamp)
      ? new Date(quoteTimestamp).toISOString()
      : null,
    quoteAgeSeconds: quoteAgeSeconds === null
      ? null
      : Number(quoteAgeSeconds.toFixed(2)),
    quoteFreshnessAvailable,
    quoteFreshnessPass,
    spreadTimestamp: Number.isFinite(spreadTimestamp)
      ? new Date(spreadTimestamp).toISOString()
      : null,
    spreadAgeSeconds: spreadAgeSeconds === null
      ? null
      : Number(spreadAgeSeconds.toFixed(2)),
    spreadFreshnessAvailable,
    spreadFreshnessPass,
    decisionTimestamp: Number.isFinite(decisionTimestamp)
      ? new Date(decisionTimestamp).toISOString()
      : null,
    decisionAgeSeconds: decisionAgeSeconds === null
      ? null
      : Number(decisionAgeSeconds.toFixed(2)),
    decisionFreshnessAvailable,
    decisionFreshnessPass,
    thresholds: {
      ...STOCK_EXECUTION_THRESHOLDS,
      maxSpreadPercent: effectiveMaxSpread,
      maxQuoteAgeSeconds: effectiveMaxQuoteAgeSeconds,
      maxDecisionAgeSeconds: effectiveMaxDecisionAgeSeconds,
    },
    reasons,
  };
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
  const percentChange = firstFinite(signal.percentChange, signal.changePercent);
  const participationBase = clamp(
    55 + (Number(relativeVolume || 0) - 0.5) * 30
  );
  const participation = clamp(
    participationBase - Math.max(0, Number(relativeVolume || 0) - 3) * 12
  );
  const catalyst = firstFinite(
    signal.catalystRanking?.catalystScore,
    signal.catalystScore,
    signal.newsCatalystScore
  );
  const catalystAvailable = signal.catalystRanking
    ? signal.catalystRanking.catalystAvailable === true
    : catalyst !== undefined;
  // preMoveScore already contains compression, accumulation, quiet timing and
  // liquidity. Treat it as one bounded family and do not count current quietness
  // or relative volume again.
  const structure = preMove !== undefined ? preMove : accumulation;
  const components = preMove !== undefined
    ? [
      component("preMoveStructure", structure, 0.85, "preMoveScore", true),
      component("catalystNovelty", catalyst, 0.15, "catalystScore", catalystAvailable),
    ]
    : [
      component("preMoveStructure", structure, 0.6, "accumulationScore", structure !== undefined),
      component("unusualParticipation", participation, 0.25, "relativeVolume", relativeVolume !== undefined),
      component("catalystNovelty", catalyst, 0.15, "catalystScore", catalystAvailable),
    ];
  const rawCard = scorecard("EARLY_DISCOVERY", components);
  const baseCard = scorecard(
    "EARLY_DISCOVERY_TECHNICAL_BASE",
    components.filter((item) => item.name !== "catalystNovelty")
  );
  const catalystBonus = catalystAvailable
    ? Math.max(0, Math.min(8, (clamp(catalyst) - 50) * 0.16))
    : 0;
  let card = rescaleScorecard(rawCard, baseCard.score + catalystBonus);
  const positiveChange = Number(percentChange || 0);
  const lateMoveCap = positiveChange >= 10 ? 55 : positiveChange >= 8 ? 64 : 100;
  const extensionProfile = signal.multiHorizonExtension ||
    signal.extensionProfile ||
    signal.preMoverDiscovery?.extension ||
    signal.preMoverDiscovery?.extensionProfile ||
    null;
  const completedDailyBars = firstFinite(
    signal.discoveryScorecard?.dataQuality?.completedValidDailyBars,
    signal.preMoverDiscovery?.discoveryScorecard?.dataQuality?.completedValidDailyBars,
    signal.historyDays,
    signal.preMoverDiscovery?.historyDays
  );
  const canonicalExtensionEvidencePass =
    extensionProfile !== null &&
    Number(extensionProfile?.coverage || 0) >= 1 &&
    Number(completedDailyBars || 0) >= 21;
  const extensionAlreadyApplied = signal.extensionAdjusted === true ||
    signal.preMoverDiscovery?.extensionAdjusted === true;
  if (!extensionAlreadyApplied && Number(extensionProfile?.extensionPenalty || 0) > 0) {
    card = rescaleScorecard(
      card,
      Math.max(0, card.score - Number(extensionProfile.extensionPenalty || 0))
    );
  }
  const multiHorizonLateCap =
    extensionProfile?.alreadyExtended === true || !canonicalExtensionEvidencePass
      ? 55
      : 100;
  const effectiveLateCap = Math.min(lateMoveCap, multiHorizonLateCap);
  if (card.score > effectiveLateCap) {
    card = rescaleScorecard(card, effectiveLateCap);
  }
  card.gates = [...new Set([
    ...card.gates,
    ...(lateMoveCap < 100 ? ["ALREADY_LOUD_MOVE"] : []),
    ...(extensionProfile?.alreadyExtended === true
      ? ["ALREADY_EXTENDED_MULTI_HORIZON"]
      : []),
    ...(!canonicalExtensionEvidencePass
      ? ["MISSING_CANONICAL_MULTI_HORIZON_EVIDENCE"]
      : []),
  ])];
  return {
    ...card,
    technicalBaseScore: baseCard.score,
    catalystBonus: Number(catalystBonus.toFixed(2)),
    extensionProfile,
    canonicalExtensionEvidencePass,
    completedValidDailyBars: Number(completedDailyBars || 0),
    tier: effectiveLateCap < 72
      ? "LATE_MOVE_NOT_DISCOVERY"
      : card.score >= 85 && card.coverage >= 0.8
      ? "ELITE_DISCOVERY"
      : card.score >= 72 && card.coverage >= 0.65
        ? "STRONG_DISCOVERY"
        : card.score >= 58 && card.coverage >= 0.5
          ? "DEVELOPING_DISCOVERY"
          : "LOW_DISCOVERY",
  };
}

export function calculateEntryQualityScore(signal = {}) {
  const confirmations = signal.confirmations || {};
  const technicals = signal.technicals || {};
  const quality = signal.phase5SignalQuality || signal.institutionalSignalQuality || {};
  const profile = signal.runnerStageProfile || {};
  const closeNearHigh = firstFinite(confirmations.closeNearHighPercent, profile.closeNearHighPercent);
  const ema9 = firstFinite(technicals.ema9);
  const ema20 = firstFinite(technicals.ema20);
  const macd = firstFinite(technicals.macd);
  const macdSignal = firstFinite(technicals.macdSignal);
  const rsiValue = firstFinite(technicals.rsi);
  const technicalBarsFound = firstFinite(
    signal.technicalBarsFound,
    Array.isArray(signal.stockChartBars) ? signal.stockChartBars.length : undefined,
    Array.isArray(signal.chartBars) ? signal.chartBars.length : undefined,
    Array.isArray(signal.historicalBars) ? signal.historicalBars.length : undefined,
    confirmations.barsFound
  );
  const trendAvailable = [ema9, ema20, macd, macdSignal, rsiValue].every((value) => value !== undefined)
    && Number(technicalBarsFound || 0) >= 20;
  const rsi = Number(rsiValue || 50);
  const trendAlignment = clamp(
    35 +
    (Number(ema9 || 0) > Number(ema20 || 0) ? 30 : 0) +
    (Number(macd || 0) > Number(macdSignal || 0) ? 20 : 0) +
    (rsi >= 45 && rsi <= 72 ? 15 : rsi > 82 ? -25 : 0)
  );
  const priceLocationAvailable = closeNearHigh !== undefined;
  const priceLocation = clamp(
    Number(closeNearHigh || 0) - Number(quality.vwapExtensionPenalty || 0) * 0.45 - Number(quality.candleRejectionRisk || 0) * 0.25
  );
  const setupAvailable = typeof confirmations.aboveVwap === "boolean"
    || typeof quality.breakoutRetestConfirmation === "boolean"
    || typeof confirmations.fakeBreakout === "boolean";
  const setupConfirmation = clamp(
    30
    + (confirmations.aboveVwap === true ? 25 : 0)
    + (quality.breakoutRetestConfirmation === true ? 30 : 0)
    + (confirmations.fakeBreakout === false ? 15 : confirmations.fakeBreakout === true ? -40 : 0)
  );
  const liquidity = firstFinite(quality.liquidityStabilityScore, signal.liquidityStabilityScore);
  const spreadEvidence = resolveMeasuredStockSpread(signal, quality);
  const measuredSpread = spreadEvidence.spreadPercent;
  const spreadEvidenceAvailable = measuredSpread !== null;
  const maxAllowedSpreadPercent = Number.isFinite(Number(signal.maxAllowedSpreadPercent))
    ? Math.min(
      STOCK_EXECUTION_THRESHOLDS.maxSpreadPercent,
      Math.max(0, Number(signal.maxAllowedSpreadPercent))
    )
    : STOCK_EXECUTION_THRESHOLDS.maxSpreadPercent;
  const spreadTooWide =
    spreadEvidenceAvailable && measuredSpread > maxAllowedSpreadPercent;
  const riskInputs = [
    firstFinite(quality.antiChaseRisk, signal.antiChaseRisk),
    firstFinite(quality.exhaustionRisk, signal.exhaustionRisk),
    firstFinite(quality.spreadWideningRisk, signal.spreadWideningRisk),
  ].filter((value) => value !== undefined);
  const riskAvailable = riskInputs.length > 0;
  const riskProtection = riskAvailable ? clamp(100 - Math.max(...riskInputs.map(Number))) : 0;
  const independentRisk = riskAvailable ? Math.max(...riskInputs.map(Number)) : 0;
  const extremeEntryRisk = independentRisk >= 80;
  const newsRiskRequired = signal.requireNewsRiskForEntry === true;
  const newsRiskUnavailable =
    newsRiskRequired && confirmations.newsRiskAvailable !== true;
  const hardReject = quality.hardReject === true || confirmations.newsRisk === true || newsRiskUnavailable || signal.lateChaseRisk === true || extremeEntryRisk || spreadTooWide;
  const components = [
    component("trendAlignment", trendAlignment, 0.23, "ema_macd_rsi", trendAvailable),
    component("priceLocation", priceLocation, 0.22, "close_vwap_rejection", priceLocationAvailable),
    component("setupConfirmation", setupConfirmation, 0.22, "vwap_retest_breakout", setupAvailable),
    component("liquidityExecution", liquidity, 0.18, `liquidity_and_${spreadEvidence.source}`, liquidity !== undefined && spreadEvidenceAvailable),
    component("riskProtection", riskProtection, 0.15, "max_independent_risk", riskAvailable),
  ];
  const missingCriticalEvidence = components.filter((item) => !item.available).map((item) => item.name);
  if (!spreadEvidenceAvailable) missingCriticalEvidence.push("spreadEvidence");
  const gates = [
    ...(hardReject ? ["HARD_RISK_REJECT"] : []),
    ...(newsRiskUnavailable ? ["NEWS_RISK_UNAVAILABLE"] : []),
    ...(extremeEntryRisk ? ["EXTREME_ENTRY_RISK"] : []),
    ...(spreadTooWide ? ["SPREAD_ABOVE_EXECUTION_LIMIT"] : []),
    ...missingCriticalEvidence.map((name) => `MISSING_${name.replace(/([a-z])([A-Z])/g, "$1_$2").toUpperCase()}`),
  ];
  const rawCard = scorecard("ENTRY_QUALITY", components, gates);
  const spreadPenaltyStart = Math.min(0.1, maxAllowedSpreadPercent * 0.25);
  const spreadPenaltyRange = Math.max(
    0.01,
    maxAllowedSpreadPercent - spreadPenaltyStart
  );
  const spreadPenalty = spreadEvidenceAvailable
    ? Math.max(
      0,
      Math.min(
        20,
        ((measuredSpread - spreadPenaltyStart) / spreadPenaltyRange) * 20
      )
    )
    : 0;
  const spreadQualityScore = spreadEvidenceAvailable
    ? clamp(100 - (measuredSpread / Math.max(0.01, maxAllowedSpreadPercent)) * 100)
    : 0;
  const coverageAdjustedScore =
    rawCard.score * Math.min(1, rawCard.coverage / 0.8) - spreadPenalty;
  const card = rescaleScorecard(rawCard, hardReject ? Math.min(coverageAdjustedScore, 35) : coverageAdjustedScore);
  const approved = !hardReject && missingCriticalEvidence.length === 0 && card.coverage >= 0.8 && card.score >= 75;
  return {
    ...card,
    approved,
    newsRiskRequired,
    spreadPercent: measuredSpread,
    spreadSource: spreadEvidence.source,
    spreadPenalty: Number(spreadPenalty.toFixed(2)),
    spreadQualityScore: Number(spreadQualityScore.toFixed(2)),
    tier: hardReject
      ? "BLOCKED"
      : missingCriticalEvidence.length > 0
        ? "WAIT_FOR_DATA"
        : card.score >= 85
          ? "ELITE_ENTRY"
          : card.score >= 75
            ? "GOOD_ENTRY"
            : card.score >= 60
              ? "WAIT_FOR_ENTRY"
              : "POOR_ENTRY",
  };
}

function normalizeSessionDay(value) {
  const raw = value && typeof value === "object"
    ? value.dayKey ?? value.dateKey ?? value.sessionDate ?? value.date ?? value.completedAt ?? value.timestamp
    : value;
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw === "string") {
    const match = raw.match(/^\d{4}-\d{2}-\d{2}/);
    if (match) return match[0];
  }
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

export function getUniqueStockSessionDays(values = []) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map(normalizeSessionDay).filter(Boolean))].sort();
}

function getNewYorkDayKey(now = Date.now()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(now));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function getCompletedUniqueStockSessionDays(values = [], { now = Date.now() } = {}) {
  const todayKey = getNewYorkDayKey(now);
  return getUniqueStockSessionDays(values).filter(
    (dayKey) => dayKey < todayKey && isUsStockMarketSessionDayKey(dayKey)
  );
}

export function calculateMultiDayContinuationScore(signal = {}, { now = Date.now() } = {}) {
  const memory = signal.multiDayAccumulation || {};
  const confirmations = signal.confirmations || {};
  const observedSessionDays = getCompletedUniqueStockSessionDays(
    Array.isArray(memory.completedSeenDays) ? memory.completedSeenDays : memory.seenDays,
    { now }
  );
  const seenDays = observedSessionDays.length;
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
    component("multiSessionEvidence", sessionEvidence, 0.18, "multiDayMemory.uniqueSeenDays", seenDays > 0),
    component("trendDurability", trendDurability, 0.18, "trend_support"),
    component("exhaustionResistance", 100 - exhaustion, 0.1, "max_exhaustion_risk"),
  ];
  const rawCard = scorecard("MULTI_DAY_CONTINUATION", components);
  const card = rescaleScorecard(rawCard, rawCard.score * rawCard.coverage);
  return {
    ...card,
    observedSessions: seenDays,
    observedSessionDays,
    sessionEvidenceVerified: seenDays > 0,
    tier: card.score >= 85 && seenDays >= 4
      ? "ELITE_CONTINUATION"
      : card.score >= 72 && seenDays >= 3
        ? "STRONG_CONTINUATION"
        : card.score >= 60 && seenDays >= 2
          ? "POSSIBLE_CONTINUATION"
          : "INTRADAY_ONLY",
  };
}

export function buildStockDecisionScore(signal = {}) {
  const discovery = signal.discoveryScorecard || calculateEarlyDiscoveryScore(signal);
  const entry = signal.entryQualityScorecard || calculateEntryQualityScore(signal);
  const contextScore = firstFinite(
    signal.contextScore,
    signal.phase12MacroCorrelation?.macroCorrelationScore,
    signal.macroScore
  );
  const directRiskPortfolioScore = firstFinite(signal.riskPortfolioScore);
  const riskQualityScore = firstFinite(
    signal.blendedRiskScore,
    signal.riskScore,
    signal.institutionalRiskScore
  );
  const portfolioFitScore = firstFinite(
    signal.portfolioScore,
    signal.portfolioConstructionScore
  );
  const riskPortfolioScore = directRiskPortfolioScore !== undefined
    ? directRiskPortfolioScore
    : riskQualityScore !== undefined && portfolioFitScore !== undefined
      ? Number(riskQualityScore) * 0.7 + Number(portfolioFitScore) * 0.3
      : riskQualityScore !== undefined
        ? riskQualityScore
        : portfolioFitScore;
  const riskPortfolioSource = directRiskPortfolioScore !== undefined
    ? "riskPortfolioScore"
    : riskQualityScore !== undefined && portfolioFitScore !== undefined
      ? "risk_quality_70_portfolio_fit_30"
      : riskQualityScore !== undefined
        ? "risk_quality"
        : "portfolio_fit";
  const fundamentalScore = firstFinite(
    signal.fundamentalBlendScore,
    signal.fundamentalScore,
    signal.dcfValuationScore
  );
  const fundamentalDataValid = signal.fundamentalDataValid === true;
  const reinforcementLearningActive =
    signal.reinforcementLearningActive === true ||
    signal.reinforcementWeightState?.active === true;
  const reinforcementWeights = reinforcementLearningActive
    ? signal.reinforcementWeights || {}
    : {};
  const outcomeLearning = signal.stockOutcomeLearning || {};
  const outcomeLearningActive = outcomeLearning.active === true;
  const outcomeMultiplier = (name) => {
    if (!outcomeLearningActive) return 1;
    const value = firstFinite(outcomeLearning.componentMultipliers?.[name]);
    return value === undefined
      ? 1
      : Math.max(0.95, Math.min(1.05, Number(value)));
  };
  const boundedRatio = (key, fallback) => {
    const value = firstFinite(reinforcementWeights[key]);
    if (value === undefined) return 1;
    return Math.max(0.9, Math.min(1.1, Number(value) / fallback));
  };
  const discoveryLearningMultiplier = Math.max(0.9, Math.min(1.1,
    (
      boundedRatio("momentum", 0.18) * 0.18 +
      boundedRatio("statisticalEdge", 0.2) * 0.2
    ) / 0.38
  ));
  const learnedWeights = {
    discovery: STOCK_DECISION_WEIGHTS.discovery * discoveryLearningMultiplier * outcomeMultiplier("discovery"),
    entry: STOCK_DECISION_WEIGHTS.entry * boundedRatio("technicals", 0.25) * outcomeMultiplier("entry"),
    marketContext: STOCK_DECISION_WEIGHTS.marketContext * boundedRatio("macro", 0.1) * outcomeMultiplier("marketContext"),
    riskPortfolio: STOCK_DECISION_WEIGHTS.riskPortfolio * boundedRatio("riskQuality", 0.15) * outcomeMultiplier("riskPortfolio"),
    fundamentals: STOCK_DECISION_WEIGHTS.fundamentals * boundedRatio("fundamentals", 0.12) * outcomeMultiplier("fundamentals"),
  };
  const learnedWeightTotal = Object.values(learnedWeights).reduce((sum, value) => sum + value, 0);
  const effectiveWeights = Object.fromEntries(
    Object.entries(learnedWeights).map(([name, value]) => [name, Number((value / learnedWeightTotal).toFixed(6))])
  );
  const components = [
    component("discovery", discovery.score, effectiveWeights.discovery, "discoveryScorecard", true),
    component("entry", entry.score, effectiveWeights.entry, "entryQualityScorecard", true),
    component("marketContext", contextScore, effectiveWeights.marketContext, "macro_sector_context", contextScore !== undefined),
    component("riskPortfolio", riskPortfolioScore, effectiveWeights.riskPortfolio, riskPortfolioSource, riskPortfolioScore !== undefined),
    component("fundamentals", fundamentalScore, effectiveWeights.fundamentals, "validated_fundamentals", fundamentalDataValid && fundamentalScore !== undefined),
  ];
  const rawCard = scorecard("STOCK_DECISION", components);
  // Missing optional evidence must never improve the final score. Preserve
  // normalized component telemetry, then apply a small conservative penalty
  // proportional to unavailable configured weight.
  const missingEvidencePenalty = Math.max(
    0,
    Number(((1 - rawCard.coverage) * 25).toFixed(2))
  );
  const card = rescaleScorecard(
    rawCard,
    Math.max(0, rawCard.score - missingEvidencePenalty)
  );
  const canonicalDiscoveryRequired = [
    "EARLY_DISCOVERY",
    "BOUNDED_STOCK_QUIET_DISCOVERY",
  ].includes(String(discovery.stage || "").toUpperCase());
  const canonicalDiscoveryPass =
    !canonicalDiscoveryRequired ||
    discovery.canonicalExtensionEvidencePass === true ||
    (
      discovery.dataQuality?.fullExtensionCoverage === true &&
      Number(discovery.dataQuality?.completedValidDailyBars || 0) >= 21
    );
  const missingCriticalEvidence = [
    ...(discovery.coverage < 0.65 ? ["discoveryEvidence"] : []),
    ...(canonicalDiscoveryPass ? [] : ["canonicalDiscoveryExtensionEvidence"]),
    ...(entry.coverage < 0.8 ? ["entryEvidence"] : []),
    ...(entry.approved !== true ? ["approvedEntry"] : []),
    ...(card.coverage < 0.8 ? ["decisionCoverage"] : []),
  ];
  return {
    ...card,
    coreEvidencePass: missingCriticalEvidence.length === 0,
    missingCriticalEvidence,
    missingEvidencePenalty,
    canonicalDiscoveryPass,
    effectiveWeights,
    reinforcementWeightsApplied: Object.keys(reinforcementWeights).length > 0,
    reinforcementLearningActive,
    outcomeLearningApplied: outcomeLearningActive,
    outcomeLearningSampleCount: Number(outcomeLearning.sampleCount || 0),
    discovery,
    entry,
  };
}

export function buildDecisionScoreTelemetry(signal = {}) {
  const discovery = signal.discoveryScorecard || calculateEarlyDiscoveryScore(signal);
  const entry = signal.entryQualityScorecard || calculateEntryQualityScore(signal);
  const continuation = signal.continuationScorecard || calculateMultiDayContinuationScore(signal);
  const stockDecision = buildStockDecisionScore({
    ...signal,
    discoveryScorecard: discovery,
    entryQualityScorecard: entry,
  });
  const {
    discovery: _decisionDiscovery,
    entry: _decisionEntry,
    ...decisionStage
  } = stockDecision;
  return {
    version: 2,
    calculatedAt: new Date().toISOString(),
    scores: { discovery: discovery.score, entry: entry.score, continuation: continuation.score, decision: stockDecision.score },
    stages: { discovery, entry, continuation, decision: decisionStage },
  };
}
