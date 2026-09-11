import { evaluateStockTradeCandidate } from './decisionScores.js';
import { evaluateCryptoTradeCandidate } from './componentScore.js';
import { isCryptoSignal } from './canonicalSignalRank.js';

const list = value => Array.isArray(value) ? value : [];
// Presentation only: one current evidence set, never a union with old raw,
// telemetry or execution-gate snapshots. This function cannot grant permission.
export function buildCurrentDecisionView(signal, { now = Date.now() } = {}) {
  const crypto = isCryptoSignal(signal);
  const entry = crypto ? signal.cryptoEntryScorecard || signal.cryptoScoreTelemetry?.entry : signal.entryQualityScorecard;
  const evidence = crypto ? signal.cryptoScoreTelemetry?.decision : signal.stockDecisionEvidence;
  const discovery = (crypto ? signal.cryptoDiscoveryScorecard : signal.discoveryScorecard) || signal.decisionScoreTelemetry?.stages?.discovery;
  const gate = crypto ? evaluateCryptoTradeCandidate(signal, { now }) : evaluateStockTradeCandidate(signal, {
    requireCentralDecision: true, requireFreshDecision: true, requireExplicitApproval: true, now,
  });
  const researchReasons = [...new Set([
    ...list(signal.marketContextEvidence?.missingEvidenceReasons),
    ...((signal.confirmations?.recentVolume || signal.recentVolume)?.missingReason
      ? [(signal.confirmations?.recentVolume || signal.recentVolume).missingReason] : []),
    ...list(signal.executionEligibility?.reasons).filter(reason => reason === 'CENTRAL_RISK_AND_SIZING_REVIEW_REQUIRED'),
    ...list(discovery?.missingCriticalEvidence), ...list(discovery?.missingComponents),
    ...list(entry?.missingCriticalEvidence), ...list(entry?.missingComponents), ...list(entry?.gates),
    ...list(evidence?.missingCriticalEvidence), ...list(evidence?.missingComponents),
    ...list(signal.scoreCompleteness?.missingEvidenceReasons).filter(reason =>
      /^(CANONICAL_(STOCK|CRYPTO)_FINAL_DECISION_UNAVAILABLE|(STOCK|CRYPTO)_(DISCOVERY_SCORE|ENTRY_SCORE|MULTI_DAY_EVIDENCE)_UNAVAILABLE|POSITION_SIZING_PENDING)$/.test(reason)),
  ])];
  const reasons = [...new Set([...researchReasons, ...gate.reasons])];
  return { version: 1, evaluatedAt: new Date(now).toISOString(),
    assessmentAt: signal.scoreAssessmentUpdatedAt || signal.decisionUpdatedAt || null,
    researchReasons, executionReasons: gate.reasons, reasons };
}
