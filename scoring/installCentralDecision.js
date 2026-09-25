import { hasDecisionAnalysis } from './decisionAnalysis.js';
import { retainMeasuredStockScores } from './measuredScoreHistory.js';
import { canPublishDecision } from './decisionProvenance.js';
import { completeCentralReview } from './analyticalAuthorization.js';
import { authorizeAnalyticalSnapshot } from './analyticalSnapshot.js';
import { classifySetupOutcome, nbboMidpoint } from './setupDrift.js';
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
  const review = completeCentralReview(signal, available ? score : null, now);
  const analytical = signal.currentAnalyticalSnapshot || evidence?.currentAnalyticalSnapshot || null;
  const authorizedDecisionSnapshot = review
    ? authorizeAnalyticalSnapshot(analytical, review.scoreVersion, new Date(now).toISOString())
    : null;
  const reviewingMove = signal.rescoreStatus === "QUEUED" || signal.rescoreStatus === "RUNNING" || signal.setupRevalidationRequired === true;
  const previousReference = signal.decisionReferencePrice;
  const mid = nbboMidpoint(signal);
  Object.assign(signal, review || {}, {
    centralAutonomousDecisionCore: decision,
    decisionRevision: decision.decisionRevision ?? null,
    decisionProvenance: decision.provenance ?? null,
    decisionLatency: decision.decisionLatency ?? null,
    riskPolicyVersion: decision.riskPolicyVersion || null,
    decisionUpdatedAt: new Date(now).toISOString(),
    scoreAssessmentUpdatedAt: new Date(now).toISOString(),
    decisionReferencePrice: mid ? mid.price : null,
    decisionReferencePriceType: mid ? "NBBO_MID" : null,
    decisionReferenceTimestamp: mid ? new Date(now).toISOString() : null,
    rescoreStatus: "NONE",
    rescoreReason: null,
    executionWaitReason: null,
    evidenceWaitReason: null,
    setupRevalidationRequired: false,
    quoteRevalidationBasis: null,
    centralAutonomousAction: decision.action,
    finalAutonomousDecisionScore: available ? score : null,
    masterFinalScore: available ? score : null,
    ...(authorizedDecisionSnapshot ? {
      authorizedDecisionSnapshot,
      authorizedF: authorizedDecisionSnapshot.authorizedF,
    } : {}),
    ...(crypto ? {
      cryptoDecisionScore: available ? score : null,
      cryptoDecisionScoreAvailable: available,
      cryptoScoreTelemetry: { ...(signal.cryptoScoreTelemetry || {}), decision: evidence },
      provisionalCryptoDecisionScore: decision.provisionalCryptoDecisionScore,
    } : {
      stockDecisionScore: available ? score : null,
      stockDecisionScoreAvailable: available,
      stockDecisionEvidence: evidence,
      discoveryLane: evidence?.discoveryLane || signal.discoveryLane,
      continuationSetup: evidence?.continuationSetup || signal.continuationSetup,
    }),
  });
  if (reviewingMove) signal.setupReviewOutcome = classifySetupOutcome(signal, { previousReference });
  return crypto ? signal : retainMeasuredStockScores(signal, {}, now);
}
