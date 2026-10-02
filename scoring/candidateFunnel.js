import { STOCK_EXECUTION_THRESHOLDS } from "./stockQualificationPolicy.js";
import { liveCryptoPermission } from "./cryptoAnalyticalShadow.js";

export const STOCK_FUNNEL_STAGES = Object.freeze([
  "UNIVERSE",
  "BASIC_FILTER",
  "DISCOVERY_COMPLETE",
  "D_THRESHOLD",
  "TECHNICAL_EVIDENCE",
  "ENTRY_THRESHOLD",
  "F_THRESHOLD",
  "AUTHORIZATION",
  "EVIDENCE_READY",
  "EXECUTION_READY",
  "RISK_APPROVED",
  "SIZED",
  "BUYABLE",
]);

export const CRYPTO_FUNNEL_STAGES = Object.freeze([
  "UNIVERSE",
  "BASIC_FILTER",
  "DISCOVERY_COMPLETE",
  "D_THRESHOLD",
  "SETUP_READY",
  "F_THRESHOLD",
  "AUTHORIZATION",
  "EVIDENCE_READY",
  "EXECUTION_READY",
  "RISK_APPROVED",
  "SIZED",
  "BUYABLE",
]);

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function buildCandidateFunnel(signal = {}, { asset = "stock", now = new Date().toISOString() } = {}) {
  const previous = signal.candidateFunnel && typeof signal.candidateFunnel === "object"
    ? signal.candidateFunnel
    : null;
  const stages = asset === "crypto" ? CRYPTO_FUNNEL_STAGES : STOCK_FUNNEL_STAGES;
  const discovery = finite(signal.discoveryScore ?? signal.discoveryScorecard?.score ?? signal.cryptoDiscoveryScore);
  const entry = finite(signal.entryQualityScore ?? signal.cryptoEntryScore);
  const cryptoShadow = signal.cryptoAnalyticalShadow
    || signal.cryptoScoreTelemetry?.decision?.cryptoAnalyticalShadow
    || signal.centralAutonomousDecisionCore?.cryptoDecisionEvidence?.cryptoAnalyticalShadow;
  const finalScore = finite(asset === "crypto"
    ? cryptoShadow?.cryptoAnalyticalF
    : signal.currentAnalyticalScore ?? signal.stockDecisionScore);
  const requiredF = asset === "crypto" ? null : STOCK_EXECUTION_THRESHOLDS.finalScore;
  const technicalReady = asset === "crypto"
    ? cryptoShadow?.E?.state === "PASS" || signal.cryptoSetupGate?.approved === true || signal.setupReady === true
    : signal.technicalSnapshot?.packageComplete === true
      || signal.technicals?.technicalSnapshot?.packageComplete === true
      || signal.technicalPackageComplete === true
      || signal.technicals?.technicalPackageComplete === true
      || signal.technicalEvidenceReady === true;
  const checks = {
    UNIVERSE: true,
    BASIC_FILTER: signal.basicFilterPassed !== false,
    DISCOVERY_COMPLETE: discovery !== null,
    D_THRESHOLD: discovery !== null && discovery >= (asset === "crypto" ? 60 : 60),
    TECHNICAL_EVIDENCE: technicalReady,
    SETUP_READY: technicalReady,
    ENTRY_THRESHOLD: asset === "crypto"
      ? entry !== null
      : signal.entryApproved === true || signal.entryQualityScorecard?.approved === true,
    F_THRESHOLD: finalScore !== null && (requiredF === null || finalScore >= requiredF),
    AUTHORIZATION: signal.authorizedDecisionValid === true
      || signal.currentDecision?.authorization?.approved === true,
    EVIDENCE_READY: asset === "crypto"
      ? cryptoShadow?.C?.state === "PASS"
      : signal.evidenceReady === true || signal.opportunityLayers?.C?.state === "PASS",
    EXECUTION_READY: signal.executionReady === true || signal.opportunityLayers?.X?.state === "PASS" || cryptoShadow?.X?.state === "PASS",
    RISK_APPROVED: signal.riskApproved === true
      || signal.opportunityLayers?.R?.state === "PASS"
      || signal.opportunityLayers?.R?.state === "PASS_WITH_CONSTRAINT"
      || cryptoShadow?.R?.state === "PASS"
      || cryptoShadow?.R?.state === "PASS_WITH_CONSTRAINT",
    SIZED: finite(signal.finalApprovedTradeAmount ?? signal.recommendedTradeAmount
      ?? signal.opportunityLayers?.S?.amount) > 0,
    BUYABLE: signal.buyable === true || signal.buyableNow === true || cryptoShadow?.buyable === true,
  };
  let blocker = null;
  for (const stage of stages) {
    if (checks[stage] !== true) {
      blocker = signal.buyBlockReason || stage;
      break;
    }
  }
  const rejectionReasons = [...new Set([
    signal.buyBlockReason,
    ...(signal.currentDecision?.reasons || []),
    ...(signal.stockTradeEvidence?.reasons || []),
    ...(asset === "crypto" && cryptoShadow ? liveCryptoPermission(cryptoShadow).reasons : []),
  ].filter(Boolean))];
  const currentEvent = {
    time: now,
    status: blocker ? "REJECTED" : "BUYABLE",
    stage: blocker,
    D: discovery,
    E: entry,
    F: finalScore,
    exactBlocker: signal.buyBlockReason || blocker,
    reasons: rejectionReasons,
    price: finite(signal.price ?? signal.current),
  };
  const history = Array.isArray(previous?.history)
    ? previous.history.filter((event) => event && typeof event === "object").slice(-49)
    : [];
  const previousEvent = history.at(-1);
  const eventSignature = (event) => JSON.stringify({
    status: event?.status,
    stage: event?.stage,
    D: event?.D,
    E: event?.E,
    F: event?.F,
    exactBlocker: event?.exactBlocker,
    reasons: event?.reasons || [],
  });
  if (eventSignature(previousEvent) === eventSignature(currentEvent)) {
    history[history.length - 1] = currentEvent;
  } else {
    history.push(currentEvent);
  }
  return {
    asset,
    symbol: signal.symbol || null,
    time: now,
    D: discovery,
    E: entry,
    F: finalScore,
    stage: blocker,
    status: blocker ? "REJECTED" : "BUYABLE",
    exactBlocker: signal.buyBlockReason || blocker,
    stages,
    discovery,
    entry,
    finalScore,
    evidenceCoverage: finite(signal.decisionCoverage),
    maximumPossibleF: finite(signal.maximumPossibleF),
    blocker,
    buyable: blocker === null,
    reasons: rejectionReasons,
    history,
    firstSeenAt: signal.firstSeenAt || previous?.firstSeenAt || now,
    lastEvaluatedAt: now,
    lastFullReassessmentAt: signal.decisionUpdatedAt || null,
    priceAtRejection: blocker ? finite(signal.price ?? signal.current) : null,
    laterPrices: { m5: null, m15: null, m30: null, m60: null },
  };
}

export function stockLongOrderAllowed({
  entryApproved = false,
  finalScore = null,
  authorized = false,
  C = "WAIT",
  X = "WAIT",
  R = "WAIT",
  S = 0,
} = {}) {
  const funnel = {
    entry: entryApproved === true,
    final: finite(finalScore) !== null && finalScore >= STOCK_EXECUTION_THRESHOLDS.finalScore,
    authorization: authorized === true,
    C: C === "PASS",
    X: X === "PASS" || X === "PASS_WITH_CONSTRAINT",
    R: R === "PASS" || R === "PASS_WITH_CONSTRAINT",
    S: Number(S) > 0,
  };
  const order = ["entry", "final", "authorization", "C", "X", "R", "S"];
  const blocker = order.find((step) => funnel[step] !== true) || null;
  return { allowed: blocker === null, blocker, requiredFinalScore: STOCK_EXECUTION_THRESHOLDS.finalScore };
}

export function requireCanonicalOrder(path, decision = {}) {
  if (decision.asset === "crypto") {
    const permission = liveCryptoPermission(decision.shadow);
    const authorized = decision.authorized === true;
    const sized = Number(decision.S) > 0;
    const allowed = permission.allowed && authorized && sized;
    const blocker = allowed
      ? null
      : !permission.allowed
        ? (permission.reasons[0] || "CRYPTO_ANALYTICAL_DECISION_MISSING")
        : !authorized
          ? "authorization"
          : "S";
    return {
      path,
      allowed,
      blocker,
      score: permission.score,
      inheritsLegacyThreshold: false,
    };
  }
  const order = stockLongOrderAllowed(decision);
  return { path, ...order };
}
