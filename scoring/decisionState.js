// Diagnostic projection only. Never used to mint an approval or order amount.
import { STOCK_EXECUTION_THRESHOLDS } from './decisionScores.js';
export function decisionState(signal, evidence, gate, authorization, crypto = false) {
  const missing = evidence?.missingCriticalEvidence || [];
  const score = crypto ? signal.cryptoDecisionScore : signal.stockDecisionScore;
  const measured = typeof score === 'number' && Number.isFinite(score);
  const entry = signal.entryQualityScorecard;
  const scorePass = crypto ? measured : score >= STOCK_EXECUTION_THRESHOLDS.finalScore;
  const qualified = measured && evidence?.coreEvidencePass === true && scorePass &&
    (crypto || (entry?.approved === true && entry.coverage >= STOCK_EXECUTION_THRESHOLDS.entryCoverage));
  const reasons = authorization.blockingReasons;
  const expired = reasons.some(r => /EXPIRED|STALE|REVALIDATION_REQUIRED/.test(r));
  const revoked = reasons.some(r => /REVOKED|POLICY_CHANGED/.test(r));
  const waiting = missing.some(r => /unavailable|missing|coverage|Evidence|fresh|barHistory|liveSpread/i.test(r));
  const analysisStatus = !measured ? 'PARTIAL_ANALYSIS' : waiting ? 'WAITING_FOR_REQUIRED_EVIDENCE' : 'ANALYZED';
  const strategyStatus = qualified ? 'STRATEGY_QUALIFIED' : measured ? 'NOT_QUALIFIED' : 'UNKNOWN';
  const executionStatus = revoked ? 'REVOKED' : expired ? 'EXPIRED' : authorization.approved ? 'EXECUTION_READY'
    : waiting ? 'WAITING_FOR_REQUIRED_EVIDENCE' : 'BLOCKED';
  const accountReasons = reasons.filter(reason => /SIZING|CAPITAL|BUDGET|EXPOSURE|DAILY_LOSS|EMERGENCY_STOP|BUYING_POWER|POSITION_LIMIT/.test(reason));
  return { analysisStatus, strategyStatus, executionStatus,
    candidateQualified: qualified, executionReady: authorization.approved,
    accountEligibility: signal.accountEligibility || { status: authorization.approved ? 'ELIGIBLE_AT_DECISION' : accountReasons.length ? 'BLOCKED_OR_PENDING' : 'NOT_YET_VERIFIED',
      reasons: accountReasons,
      reason: 'Account capacity is rechecked at order submission; score alone is not account approval' },
    blockers: reasons };
}
