import { buildStockDecisionScore, calculateEntryQualityScore, evaluateStockTradeCandidate } from './decisionScores.js';
import { buildCryptoDecisionScore, evaluateCryptoTradeCandidate } from './componentScore.js';
import { getCanonicalFinalScore, isCryptoSignal } from './canonicalSignalRank.js';
import { getStockExecutionEvidenceFreshness } from '../market-data/stockQuoteEvidence.js';
import { normalizeCandidateQuote } from '../market-data/normalizeCandidateQuote.js';
import { hasDecisionAnalysis } from './decisionAnalysis.js';

// Shared by display and execution: quote changes cannot issue new permission.
export function revalidateCandidate(previous, incoming, { now = Date.now() } = {}) {
  const next = { ...normalizeCandidateQuote(incoming) };
  const crypto = isCryptoSignal(previous);
  const version = previous.decisionUpdatedAt;
  const price = Number(next.price ?? next.current);
  const reference = Number(previous.decisionReferencePrice || previous.price || previous.current);
  const drift = reference > 0 && price > 0 ? Math.abs(price / reference - 1) * 100 : Infinity;
  const setupInvalid = Boolean(previous.centralAutonomousDecisionCore) && drift > 2;
  next.setupRevalidationRequired = setupInvalid;
  next.decisionReferencePrice = reference;
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
  const before = build(previous), evidence = build(next);
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
  const basis = previous.quoteRevalidationBasis && previous.quoteRevalidationBasis.version === version
    ? previous.quoteRevalidationBasis
    : { version, final: priorFinal, component: before.score };
  next.quoteRevalidationBasis = basis;
  // A temporary outage must not permanently latch F to null. Rebuild measured
  // analysis when evidence returns; a recovered score NEVER revives permission.
  const age = now - Date.parse(version || '');
  const validBasis = Number.isFinite(basis.final) && Number.isFinite(basis.component) &&
    Number.isFinite(age) && age >= -5000 && age <= 300000;
  const available = !setupInvalid && hasDecisionAnalysis(evidence);
  const ceiling = validBasis && evidence.score < basis.component - 0.001 ? evidence.score : basis.final;
  const final = available ? Number(Math.max(0, validBasis
    ? Math.min(priorFinal ?? basis.final, ceiling, basis.final + Math.min(0, evidence.score - basis.component))
    : evidence.score).toFixed(2)) : null;
  Object.assign(next, { masterFinalScore: final, finalAutonomousDecisionScore: final,
    scoreAssessmentUpdatedAt: new Date(now).toISOString(),
    ...(crypto ? { cryptoDecisionScore: final, cryptoDecisionScoreAvailable: available }
      : { stockDecisionScore: final, stockDecisionScoreAvailable: available, stockDecisionEvidence: evidence }) });
  const gate = crypto ? evaluateCryptoTradeCandidate(next, { now }) : evaluateStockTradeCandidate(next, {
    requireCentralDecision: true, requireFreshDecision: true, requireExplicitApproval: true, now,
  });
  if (priorFinal === null && available) {
    gate.approved = false;
    gate.reasons = [...new Set([...(gate.reasons || []), 'RECOVERED_SCORE_REQUIRES_CENTRAL_REVIEW'])];
  }
  if (setupInvalid) {
    gate.approved = false;
    gate.reasons = [...new Set([...(gate.reasons || []), 'SETUP_PRICE_MOVED_RESCAN_REQUIRED'])];
  }
  next.executionEligibility = gate;
  if (!gate.approved) Object.assign(next, {
    approved: false, backendApproved: false, autoTradeApproved: false, qualifiedToBuy: false,
    recommendedTradeAmount: 0, finalApprovedTradeAmount: 0, finalTradeAmount: 0, buyableNow: false,
  });
  return next;
}
