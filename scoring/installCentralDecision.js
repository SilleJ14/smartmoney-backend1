import { hasDecisionAnalysis } from './decisionAnalysis.js';
import { retainMeasuredStockScores } from './measuredScoreHistory.js';
import { canPublishDecision } from './decisionProvenance.js';
// Only a new central calculation may replace score availability. A quote merge
// must not revive a rejected decision or restore revoked risk/sizing approvals.
export function installCentralDecision(signal, decision, { crypto = false, now = Date.now() } = {}) {
  const currentRevision = Math.max(Number(signal.decisionRevision || 0),
    Number(signal.centralAutonomousDecisionCore?.decisionRevision || 0));
  if (!canPublishDecision({ decisionRevision: currentRevision }, decision)) return signal;
  if (!crypto) retainMeasuredStockScores(signal, {}, now);
  const evidence = crypto ? decision.cryptoDecisionEvidence : decision.stockDecisionEvidence;
  const rawScore = crypto ? decision.cryptoDecisionScore ?? (hasDecisionAnalysis(evidence) ? decision.finalDecisionScore : null) : decision.finalDecisionScore;
  const score = rawScore == null || rawScore === "" ? NaN : Number(rawScore);
  const available = hasDecisionAnalysis(evidence) && Number.isFinite(score) && score >= 0 && score <= 100;
  Object.assign(signal, {
    centralAutonomousDecisionCore: decision,
    decisionRevision: decision.decisionRevision ?? null,
    decisionProvenance: decision.provenance ?? null,
    decisionLatency: decision.decisionLatency ?? null,
    riskPolicyVersion: decision.riskPolicyVersion || null,
    decisionUpdatedAt: new Date(now).toISOString(),
    scoreAssessmentUpdatedAt: new Date(now).toISOString(),
    decisionReferencePrice: Number(signal.price || signal.current || 0),
    setupRevalidationRequired: false,
    quoteRevalidationBasis: null,
    centralAutonomousAction: decision.action,
    finalAutonomousDecisionScore: available ? score : null,
    masterFinalScore: available ? score : null,
    ...(crypto ? {
      cryptoDecisionScore: available ? score : null,
      cryptoDecisionScoreAvailable: available,
      cryptoScoreTelemetry: { ...(signal.cryptoScoreTelemetry || {}), decision: evidence },
      provisionalCryptoDecisionScore: decision.provisionalCryptoDecisionScore,
    } : {
      stockDecisionScore: available ? score : null,
      stockDecisionScoreAvailable: available,
      stockDecisionEvidence: evidence,
    }),
  });
  return crypto ? signal : retainMeasuredStockScores(signal, {}, now);
}
