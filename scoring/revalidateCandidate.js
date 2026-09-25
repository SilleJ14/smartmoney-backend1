import { buildStockDecisionScore, calculateEntryQualityScore, evaluateStockTradeCandidate } from './decisionScores.js';
import { buildCryptoDecisionScore, evaluateCryptoTradeCandidate } from './componentScore.js';
import { getCanonicalFinalScore, isCryptoSignal } from './canonicalSignalRank.js';
import { getStockExecutionEvidenceFreshness } from '../market-data/stockQuoteEvidence.js';
import { normalizeCandidateQuote } from '../market-data/normalizeCandidateQuote.js';
import { hasDecisionAnalysis } from './decisionAnalysis.js';
import { retainMeasuredStockScores } from './measuredScoreHistory.js';
import { immutableBarHistory } from '../market-data/barSnapshot.js';
import { applyAnalyticalScoreUpdate } from './analyticalAuthorization.js';
import { classifyScoreChange } from './measuredComponent.js';
import { getApprovedTradeAmount } from './approvedSizing.js';
import { buildStockOpportunityLayers, finalizeStockOpportunityLayers } from './opportunityLayers.js';
import { evaluateSetupDrift } from './setupDrift.js';

// Fresh evidence replaces current F in either direction. Authorization stays
// until a new central decision is installed. There is no crypto-only ratchet.
export function publishQuoteRefreshScore(previous = {}, freshScore, {
  crypto = false,
  now = Date.now(),
  scoreChangeCause = null,
  evidenceBasis = null,
  coverage = null,
  remainingScoreDelta = null,
} = {}) {
  return applyAnalyticalScoreUpdate(previous, freshScore, {
    now,
    requiredF: crypto ? null : undefined,
    scoreChangeCause,
    evidenceBasis,
    coverage,
    remainingScoreDelta,
  });
}

// Shared by display and execution: quote changes cannot issue new permission.
export function revalidateCandidate(previous, incoming, { now = Date.now() } = {}) {
  const next = { ...normalizeCandidateQuote(incoming) };
  if (Array.isArray(next.chartBars) && !Object.isFrozen(next.chartBars)) next.chartBars = immutableBarHistory(next.chartBars);
  const crypto = isCryptoSignal(previous);
  if (!crypto) {
    const measured = retainMeasuredStockScores({ ...previous }, {}, now);
    next.measuredScoreHistory = measured.measuredScoreHistory;
  }
  const version = previous.decisionUpdatedAt;
  Object.assign(next, evaluateSetupDrift({
    ...previous,
    ...next,
    spreadReferenceSamples: previous.spreadReferenceSamples || next.spreadReferenceSamples,
    rescoreStatus: previous.rescoreStatus || next.rescoreStatus,
    rescoreTriggeredAt: previous.rescoreTriggeredAt || next.rescoreTriggeredAt,
    rescoreReferencePrice: previous.rescoreReferencePrice ?? next.rescoreReferencePrice,
    rescoreDistance: previous.rescoreDistance ?? next.rescoreDistance,
    maxDriftSinceTrigger: previous.maxDriftSinceTrigger ?? next.maxDriftSinceTrigger,
    reassessmentEvent: previous.reassessmentEvent || next.reassessmentEvent,
    decisionReferencePrice: previous.decisionReferencePrice ?? next.decisionReferencePrice,
    decisionReferencePriceType: previous.decisionReferencePriceType || next.decisionReferencePriceType,
    decisionReferenceTimestamp: previous.decisionReferenceTimestamp || next.decisionReferenceTimestamp,
    setupRevalidationRequired: previous.setupRevalidationRequired === true,
  }, { now }));
  if (!crypto) {
    const freshness = getStockExecutionEvidenceFreshness(next, { now });
    next.liveQuoteFresh = freshness.quoteFresh;
    next.liveSpreadFresh = freshness.spreadFresh;
    const entry = calculateEntryQualityScore(next);
    next.entryQualityScorecard = entry;
    next.entryQualityScore = entry.score;
    next.entryQualityScoreAvailable = entry.coverage >= 0.8 && next.liveSpreadFresh !== false && next.liveQuoteFresh !== false;
  }
  if (!previous.centralAutonomousDecisionCore) return next;
  const build = crypto ? s => buildCryptoDecisionScore(s, { now }) : buildStockDecisionScore;
  const existingBasis = previous.quoteRevalidationBasis?.version === version
    ? previous.quoteRevalidationBasis : null;
  // A pinned basis belongs to this decision version. Rebuilding the previous
  // score here was discarded whenever that basis existed, allocating another
  // complete set of bars/setup evidence on every quote and screen refresh.
  const before = existingBasis ? null : build(previous);
  const evidence = build(next);
  if (crypto) {
    const entry = evidence.componentsByName?.execution;
    const entryAvailable = entry?.available === true && evidence.quoteFreshness?.fresh === true && evidence.spreadFreshness?.fresh === true;
    next.cryptoEntryScore = entryAvailable ? entry.value : null;
    next.cryptoEntryScoreAvailable = entryAvailable;
    next.cryptoEntryScorecard = { score: next.cryptoEntryScore, available: entryAvailable,
      missingComponents: entryAvailable ? [] : ['CURRENT_CRYPTO_ENTRY_EVIDENCE_UNAVAILABLE'] };
    next.cryptoScoreTelemetry = { ...(next.cryptoScoreTelemetry || {}), entry: next.cryptoEntryScorecard, decision: evidence };
  }
  const priorFinal = getCanonicalFinalScore(previous);
  // Keep the last measured assessment separately. It is explicitly historical,
  // never copied into current E/F or used to approve a trade during an outage.
  const priorAssessmentAt = previous.scoreAssessmentUpdatedAt || version;
  const priorAssessmentAge = now - Date.parse(priorAssessmentAt || '');
  const priorEntryAvailable = crypto ? previous.cryptoEntryScoreAvailable === true : previous.entryQualityScoreAvailable === true;
  if ((priorEntryAvailable || !previous.lastMeasuredAssessment) && priorFinal !== null && Number.isFinite(priorAssessmentAge) && priorAssessmentAge >= -5000 && priorAssessmentAge <= 300000) {
    next.lastMeasuredAssessment = { at: priorAssessmentAt,
      discovery: crypto ? previous.cryptoDiscoveryScore : previous.discoveryScore,
      entry: priorEntryAvailable ? (crypto ? previous.cryptoEntryScore : previous.entryQualityScore) : null,
      final: priorFinal, continuation: previous.multiDayScoreAvailable === true ? previous.multiDayContinuationScore : null };
  } else next.lastMeasuredAssessment = previous.lastMeasuredAssessment || null;
  const basis = existingBasis
    ? existingBasis
    : { version, final: priorFinal, component: before.score };
  next.quoteRevalidationBasis = basis;
  // A temporary outage must not permanently latch F to null. Rebuild measured
  // analysis when evidence returns; a recovered score NEVER revives permission.
  const available = hasDecisionAnalysis(evidence);
  const freshScore = available && Number.isFinite(Number(evidence.score))
    ? Number(Number(evidence.score).toFixed(2))
    : null;
  const scoreChangeCause = classifyScoreChange({
    previousBasis: previous.evidenceBasis || null,
    nextBasis: evidence.evidenceBasis || null,
    previousScore: priorFinal,
    nextScore: freshScore,
    previousCoverage: previous.decisionCoverage,
    nextCoverage: evidence.coverage,
  });
  const authorization = publishQuoteRefreshScore(previous, freshScore, {
    crypto,
    now,
    scoreChangeCause,
    evidenceBasis: evidence.evidenceBasis || null,
    coverage: evidence.coverage,
    remainingScoreDelta: evidence.analyticalBounds?.remainingScoreDelta ?? null,
  });
  next.evidenceBasis = evidence.evidenceBasis || null;
  next.evidenceBasisVersion = evidence.evidenceBasisVersion || null;
  next.decisionCoverage = evidence.coverage;
  next.maximumPossibleF = evidence.maximumPossibleF ?? null;
  next.minimumPossibleF = evidence.minimumPossibleF ?? null;
  next.analyticalBounds = evidence.analyticalBounds || null;
  next.remainingScoreDelta = evidence.analyticalBounds?.remainingScoreDelta ?? null;
  next.scoreChangeCause = scoreChangeCause;
  if (scoreChangeCause === "EVIDENCE_LOST") next.scoreVelocity = 0;
  const final = freshScore;
  const preserveScores = next.executionWaitReason === "QUOTE_UNAVAILABLE"
    || next.evidenceWaitReason === "PRICE_EVIDENCE_UNAVAILABLE"
    || next.rescoreStatus === "QUEUED"
    || next.rescoreStatus === "RUNNING";
  Object.assign(next, authorization || {}, {
    masterFinalScore: authorization?.authorizedDecisionScore ?? null,
    finalAutonomousDecisionScore: authorization?.authorizedDecisionScore ?? null,
    scoreAssessmentUpdatedAt: authorization?.scoreChangedAt
      ? authorization.scoreChangedAt
      : new Date(now).toISOString(),
    ...(crypto ? { cryptoDecisionScore: final, cryptoDecisionScoreAvailable: available && final !== null }
      : { stockDecisionScore: final, stockDecisionScoreAvailable: final !== null, stockDecisionEvidence: evidence }) });
  if (preserveScores) {
    const preservedCurrent = crypto
      ? (previous.currentAnalyticalScore ?? previous.cryptoDecisionScore)
      : (previous.currentAnalyticalScore ?? previous.stockDecisionScore);
    if (preservedCurrent != null) {
      next.currentAnalyticalScore = preservedCurrent;
      if (crypto) {
        next.cryptoDecisionScore = previous.cryptoDecisionScore ?? preservedCurrent;
        next.cryptoDecisionScoreAvailable = previous.cryptoDecisionScoreAvailable !== false;
      } else {
        next.stockDecisionScore = previous.stockDecisionScore ?? preservedCurrent;
        next.stockDecisionScoreAvailable = previous.stockDecisionScoreAvailable !== false;
      }
    }
    if (!crypto && previous.entryQualityScore != null) {
      next.entryQualityScore = previous.entryQualityScore;
      next.entryQualityScorecard = previous.entryQualityScorecard ?? next.entryQualityScorecard;
    }
    if (!crypto && previous.discoveryScore != null) next.discoveryScore = previous.discoveryScore;
    if (previous.authorizedDecisionScore != null) next.authorizedDecisionScore = previous.authorizedDecisionScore;
    if (previous.masterFinalScore != null) next.masterFinalScore = previous.masterFinalScore;
    if (previous.scoreVersion != null) next.scoreVersion = previous.scoreVersion;
  }
  const gate = crypto ? evaluateCryptoTradeCandidate(next, { now }) : evaluateStockTradeCandidate(next, {
    requireCentralDecision: true, requireFreshDecision: true, requireExplicitApproval: true, now,
  });
  if (priorFinal === null && available) {
    gate.approved = false;
    gate.reasons = [...new Set([...(gate.reasons || []), 'RECOVERED_SCORE_REQUIRES_CENTRAL_REVIEW'])];
  }
  const driftReason = next.executionWaitReason || next.evidenceWaitReason;
  if (driftReason) {
    gate.approved = false;
    gate.reasons = [...new Set([...(gate.reasons || []), driftReason])];
  }
  next.executionEligibility = gate;
  if (!crypto && authorization) {
    const layers = buildStockOpportunityLayers(next, { eligibility: gate, requiredF: authorization.requiredF || 70 });
    const report = finalizeStockOpportunityLayers(layers, getApprovedTradeAmount(previous), authorization);
    next.opportunityLayers = report;
    next.buyBlockReason = report.buyable ? null : report.blockReason;
    if (!report.buyable || gate.approved !== true) {
      Object.assign(next, {
        approved: false, backendApproved: false, autoTradeApproved: false, qualifiedToBuy: false,
        recommendedTradeAmount: 0, finalApprovedTradeAmount: 0, finalTradeAmount: 0, buyableNow: false,
      });
    }
    return next;
  }
  if (!gate.approved) Object.assign(next, {
    approved: false, backendApproved: false, autoTradeApproved: false, qualifiedToBuy: false,
    recommendedTradeAmount: 0, finalApprovedTradeAmount: 0, finalTradeAmount: 0, buyableNow: false,
  });
  return next;
}
