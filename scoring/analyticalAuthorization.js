// Current F and authorized F are different facts. A quote refresh may change
// the analytical score. Only an installed central decision may change the
// score that is allowed to trade.

import { STOCK_EXECUTION_THRESHOLDS } from "./decisionScores.js";

const STOCK_FINAL_BUY_GATE = STOCK_EXECUTION_THRESHOLDS.finalScore;

export const REVIEW_TRIGGERS = Object.freeze([
  "THRESHOLD_CROSS",
  "MATERIAL_SCORE_IMPROVEMENT",
  "SETUP_CHANGED",
  "NEW_CATALYST",
  "PERIODIC_REASSESSMENT",
  "MANUAL",
]);

function finite(value) {
  const score = Number(value);
  return Number.isFinite(score) ? score : null;
}

function roundScore(value) {
  const score = finite(value);
  return score === null ? null : Number(score.toFixed(2));
}

function meetsRequiredF(score, requiredF) {
  if (score === null) return false;
  const gate = Number(requiredF);
  if (!Number.isFinite(gate)) return true;
  return score >= gate;
}

function reviewStatus(value) {
  return value === "QUEUED" || value === "RUNNING" ? value : "NONE";
}

export function resolveScoreState(signal = {}, requiredF = STOCK_FINAL_BUY_GATE) {
  const currentAnalyticalScore = roundScore(
    signal.currentAnalyticalScore ?? signal.stockDecisionScore ?? signal.masterFinalScore
  );
  const authorizedDecisionScore = roundScore(
    signal.authorizedDecisionScore ?? signal.masterFinalScore ?? signal.finalAutonomousDecisionScore ?? signal.stockDecisionScore
  );
  const inherited = signal.authorizedDecisionValid == null
    && authorizedDecisionScore !== null
    && Boolean(signal.centralAutonomousDecisionCore);
  return {
    currentAnalyticalScore,
    authorizedDecisionScore,
    authorizedDecisionValid: signal.authorizedDecisionValid === true || inherited,
    scoreVersion: Number(signal.scoreVersion || 0),
    centralReviewStatus: reviewStatus(signal.centralReviewStatus),
    reviewTrigger: signal.reviewTrigger || null,
    lastReviewResult: signal.lastReviewResult || null,
    lastReviewCompletedAt: signal.lastReviewCompletedAt || null,
    lastFullAssessment: signal.lastFullAssessment || null,
    scoreChangedAt: signal.scoreChangedAt || null,
    requiredF,
  };
}

export function applyAnalyticalScoreUpdate(previous = {}, nextScore, {
  now = Date.now(),
  requiredF = STOCK_FINAL_BUY_GATE,
  scoreChangeCause = null,
  evidenceBasis = null,
  coverage = null,
  remainingScoreDelta = null,
} = {}) {
  const prior = resolveScoreState(previous, requiredF);
  const currentAnalyticalScore = roundScore(nextScore);
  const baseline = prior.currentAnalyticalScore;
  const changed = currentAnalyticalScore !== baseline;
  const evidenceLossRise = scoreChangeCause === "EVIDENCE_LOST"
    && baseline !== null
    && currentAnalyticalScore !== null
    && currentAnalyticalScore > baseline;
  const completionDelta = Number(remainingScoreDelta ?? previous.remainingScoreDelta ?? previous.analyticalBounds?.remainingScoreDelta);
  const aboveCompletionCeiling = Number.isFinite(completionDelta)
    && completionDelta < 0
    && baseline !== null
    && currentAnalyticalScore !== null
    && currentAnalyticalScore > baseline;
  const crossed = baseline !== null
    && !meetsRequiredF(baseline, requiredF)
    && meetsRequiredF(currentAnalyticalScore, requiredF)
    && !evidenceLossRise
    && !aboveCompletionCeiling;
  const alreadyAuthorized = prior.authorizedDecisionValid === true
    && meetsRequiredF(prior.authorizedDecisionScore, requiredF);
  let centralReviewStatus = prior.centralReviewStatus;
  let reviewTrigger = prior.reviewTrigger;
  if (crossed && !alreadyAuthorized && centralReviewStatus === "NONE") {
    centralReviewStatus = "QUEUED";
    reviewTrigger = "THRESHOLD_CROSS";
  }
  return {
    currentAnalyticalScore,
    authorizedDecisionScore: prior.authorizedDecisionScore,
    authorizedDecisionValid: prior.authorizedDecisionValid,
    scoreVersion: prior.scoreVersion,
    centralReviewStatus,
    reviewTrigger,
    lastReviewResult: prior.lastReviewResult,
    lastReviewCompletedAt: prior.lastReviewCompletedAt,
    lastFullAssessment: prior.lastFullAssessment,
    scoreChangedAt: changed && !evidenceLossRise && !aboveCompletionCeiling ? new Date(now).toISOString() : prior.scoreChangedAt,
    requiredF,
    scoreChangeCause,
    evidenceBasis: evidenceBasis || previous.evidenceBasis || null,
    decisionCoverage: coverage ?? previous.decisionCoverage ?? null,
    remainingScoreDelta: Number.isFinite(completionDelta) ? completionDelta : null,
    scoreRiseReason: evidenceLossRise
      ? "SCORE_RISE_FROM_EVIDENCE_LOSS"
      : aboveCompletionCeiling ? "SCORE_ABOVE_COMPLETION_CEILING" : null,
    analyticalImprovement: evidenceLossRise || aboveCompletionCeiling
      ? false
      : currentAnalyticalScore !== null && baseline !== null && currentAnalyticalScore > baseline,
    scoreVelocity: evidenceLossRise || aboveCompletionCeiling ? 0 : previous.scoreVelocity,
  };
}

export function requestCentralAuthorization(signal = {}, {
  now = Date.now(),
  requiredF = STOCK_FINAL_BUY_GATE,
} = {}) {
  const prior = resolveScoreState(signal, requiredF);
  const atGate = meetsRequiredF(prior.currentAnalyticalScore, requiredF);
  const alreadyAuthorized = prior.authorizedDecisionValid === true
    && meetsRequiredF(prior.authorizedDecisionScore, requiredF);
  const evidenceLoss = signal.scoreChangeCause === "EVIDENCE_LOST" || signal.scoreRiseReason === "SCORE_RISE_FROM_EVIDENCE_LOSS";
  const aboveCompletionCeiling = signal.scoreRiseReason === "SCORE_ABOVE_COMPLETION_CEILING"
    || Number(signal.remainingScoreDelta ?? signal.analyticalBounds?.remainingScoreDelta) < 0;
  const requested = atGate && !alreadyAuthorized && prior.centralReviewStatus === "NONE" && !evidenceLoss && !aboveCompletionCeiling;
  return {
    ...prior,
    centralReviewStatus: requested ? "QUEUED" : prior.centralReviewStatus,
    reviewTrigger: requested ? "THRESHOLD_CROSS" : prior.reviewTrigger,
    requested,
    checkedAt: new Date(now).toISOString(),
  };
}

export function completeCentralReview(previous = {}, score, now = Date.now()) {
  const prior = resolveScoreState(previous);
  const installed = roundScore(score);
  const iso = new Date(now).toISOString();
  const accepted = installed !== null;
  return {
    currentAnalyticalScore: accepted ? installed : prior.currentAnalyticalScore,
    authorizedDecisionScore: accepted ? installed : prior.authorizedDecisionScore,
    authorizedDecisionValid: accepted ? true : prior.authorizedDecisionValid,
    scoreVersion: accepted ? prior.scoreVersion + 1 : prior.scoreVersion,
    scoreChangedAt: accepted ? iso : prior.scoreChangedAt,
    lastFullAssessment: accepted ? iso : prior.lastFullAssessment,
    centralReviewStatus: "NONE",
    lastReviewResult: "COMPLETED",
    lastReviewCompletedAt: iso,
    reviewTrigger: prior.reviewTrigger,
    requiredF: prior.requiredF,
  };
}

export function evaluateBuyable({
  authorizedDecisionValid = false,
  authorizedDecisionScore = null,
  currentAnalyticalScore = null,
  requiredF = STOCK_FINAL_BUY_GATE,
  entryApproved,
  C = "PASS",
  X = "PASS",
  R = "PASS",
  S = 0,
  cReason = null,
  xReason = null,
  rReason = null,
} = {}) {
  const authorized = roundScore(authorizedDecisionScore);
  const current = roundScore(currentAnalyticalScore);
  const size = Number(S);
  const authorizedPass = authorizedDecisionValid === true && meetsRequiredF(authorized, requiredF);
  const currentPass = meetsRequiredF(current, requiredF);
  const entryPass = entryApproved !== false;
  const evidencePass = C === "PASS";
  const executionPass = X === "PASS";
  const riskPass = R === "PASS" || R === "PASS_WITH_CONSTRAINT";
  const sizePass = Number.isFinite(size) && size > 0;
  const buyable = authorizedPass && currentPass && entryPass && evidencePass && executionPass && riskPass && sizePass;
  const reason = !currentPass
    ? "CURRENT_ANALYTICAL_SCORE_BELOW_THRESHOLD"
    : !authorizedPass
      ? "CENTRAL_REAUTHORIZATION_REQUIRED"
      : !entryPass
        ? "ENTRY_POLICY_FAILED"
      : !evidencePass
        ? cReason || "EVIDENCE_NOT_PASS"
        : !executionPass
          ? xReason || "EXECUTION_NOT_PASS"
          : !riskPass
            ? rReason || "RISK_NOT_PASS"
            : !sizePass
              ? "POSITION_SIZE_ZERO"
              : null;
  return { buyable, reason, authorizedPass, currentPass, entryPass, evidencePass, executionPass, riskPass, sizePass };
}

export function authorizationFingerprint(signal = {}) {
  const layers = signal.opportunityLayers || {};
  const size = Number(layers.S?.amount);
  return {
    scoreVersion: signal.scoreVersion ?? null,
    currentAnalyticalScore: roundScore(signal.currentAnalyticalScore),
    authorizedDecisionScore: roundScore(signal.authorizedDecisionScore),
    C: layers.C?.state ?? null,
    X: layers.X?.state ?? null,
    R: layers.R?.state ?? null,
    S: Number.isFinite(size) ? size : roundScore(signal.finalApprovedTradeAmount) || 0,
  };
}

export function assertAuthorizationUnchanged(before, after) {
  if (!before) return;
  const keys = ["scoreVersion", "currentAnalyticalScore", "authorizedDecisionScore", "C", "X", "R", "S"];
  for (const key of keys) {
    if (before[key] !== after[key]) throw new Error("ORDER_REVALIDATION_FAILED");
  }
}
