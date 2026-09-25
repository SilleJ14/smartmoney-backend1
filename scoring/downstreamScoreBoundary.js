import { getCanonicalFinalScore } from "./canonicalSignalRank.js";

// Problem #24: F is calculated once. Later systems may authorize, reject,
// wait, or resize. They do not publish a different number as F.
// Problem #43: the same facts may still sit inside discovery, entry, or
// setup. This module only stops the post-score rewrite. It does not decide
// which single layer should own each fact.

function finiteScore(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

// A label for the separate archetype object. It is not a buy gate and it
// does not change F.
const ARCHETYPE_FIT_LABEL_BELOW = 75;

export function buildPostScoreRiskDecision({
  fakeBreakout = false,
  gapTooHigh = false,
  newsRisk = false,
  marketStress = 0,
  globalRiskOff = false,
} = {}) {
  const reasons = [];
  if (fakeBreakout === true) reasons.push("FAKE_BREAKOUT");
  if (gapTooHigh === true) reasons.push("GAP_TOO_HIGH");
  if (newsRisk === true) reasons.push("NEGATIVE_NEWS");
  if (Number(marketStress) >= 75) reasons.push("MARKET_STRESS");
  if (globalRiskOff === true) reasons.push("GLOBAL_RISK_OFF");
  return {
    state: reasons.length ? "REJECT" : "PASS",
    reasons,
    affectsF: false,
    // Problem #43: these reasons used to be subtracted from F after it existed.
    classificationAudit: "PROBLEM_43_POST_SCORE_PENALTY",
  };
}

export function archetypeFitFromScore(score) {
  const value = finiteScore(score);
  if (value === null) {
    return { score: null, status: "DATA_UNAVAILABLE", affectsF: false };
  }
  return {
    score: value,
    status: value < ARCHETYPE_FIT_LABEL_BELOW ? "WEAK_FIT" : "PASS",
    affectsF: false,
  };
}

export function separateAnalyticalScoreFromDownstream({
  analyticalScore,
  archetypeScore = null,
  fakeBreakout = false,
  gapTooHigh = false,
  newsRisk = false,
  marketStress = 0,
  globalRiskOff = false,
} = {}) {
  const F = finiteScore(analyticalScore);
  const R = buildPostScoreRiskDecision({
    fakeBreakout,
    gapTooHigh,
    newsRisk,
    marketStress,
    globalRiskOff,
  });
  return {
    F,
    archetype: archetypeFitFromScore(archetypeScore),
    R,
    rewroteF: false,
  };
}

// Master profile reads canonical F. It must not be copied back onto the
// analytical fields, and a missing score must not become 0.
export function applyMasterConsumption(signal = {}, profile = {}) {
  const consumed = getCanonicalFinalScore(signal);
  const published = consumed;
  return {
    finalMasterDecisionProfile: {
      ...profile,
      finalScore: published,
      consumedFinalScore: published,
      rewritesAnalyticalScore: false,
      authorizedScoreVersion: signal.scoreVersion ?? profile.authorizedScoreVersion ?? null,
      riskDecision: profile.riskDecision || signal.riskDecision || null,
    },
    masterFinalScore: finiteScore(signal.masterFinalScore),
    stockDecisionScore: signal.stockDecisionScore === undefined ? null : signal.stockDecisionScore,
    currentAnalyticalScore: signal.currentAnalyticalScore === undefined ? null : signal.currentAnalyticalScore,
    cryptoDecisionScore: signal.cryptoDecisionScore === undefined ? null : signal.cryptoDecisionScore,
    score: signal.score,
    legacySignalScore: signal.legacySignalScore,
    legacyMomentumScore: signal.legacyMomentumScore,
    runnerScore: signal.runnerScore,
  };
}
