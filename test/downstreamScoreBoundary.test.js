import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { evaluateBuyable } from "../scoring/analyticalAuthorization.js";
import { getCanonicalFinalScore } from "../scoring/canonicalSignalRank.js";
import {
  applyMasterConsumption,
  separateAnalyticalScoreFromDownstream,
} from "../scoring/downstreamScoreBoundary.js";
import { publishQuoteRefreshScore } from "../scoring/revalidateCandidate.js";
import { CRYPTO_MIN_FINAL_SCORE_TO_BUY } from "../scoring/componentScore.js";
import { buildStockOpportunityLayers, finalizeStockOpportunityLayers } from "../scoring/opportunityLayers.js";
import { buildCurrentAnalyticalSnapshot, reproduceFinalScore } from "../scoring/analyticalSnapshot.js";
import { installCentralDecision } from "../scoring/installCentralDecision.js";

const analyticalStock = {
  symbol: "AAPL",
  currentAnalyticalScore: 81,
  stockDecisionScore: 81,
  stockDecisionScoreAvailable: true,
  masterFinalScore: 73,
  runnerScore: 12,
  legacySignalScore: 55,
  legacyMomentumScore: 40,
  score: 55,
};

test("crypto analytical F stays put when a fake breakout rejects risk", () => {
  const separated = separateAnalyticalScoreFromDownstream({
    analyticalScore: 82,
    archetypeScore: 64,
    fakeBreakout: true,
    marketStress: 80,
  });
  assert.equal(separated.F, 82);
  assert.equal(separated.rewroteF, false);
  assert.equal(separated.R.state, "REJECT");
  assert.equal(separated.R.affectsF, false);
  assert.ok(separated.R.reasons.includes("FAKE_BREAKOUT"));
  assert.ok(separated.R.reasons.includes("MARKET_STRESS"));
  assert.equal(separated.archetype.score, 64);
  assert.equal(separated.archetype.status, "WEAK_FIT");
  assert.equal(separated.archetype.affectsF, false);
  const buy = evaluateBuyable({
    authorizedDecisionValid: true,
    authorizedDecisionScore: 82,
    currentAnalyticalScore: separated.F,
    requiredF: CRYPTO_MIN_FINAL_SCORE_TO_BUY,
    entryApproved: true,
    R: separated.R.state,
    rReason: separated.R.reasons[0],
    S: 100,
  });
  assert.equal(buy.buyable, false);
  assert.equal(buy.reason, "FAKE_BREAKOUT");
});

test("an archetype score is not copied over canonical crypto F", () => {
  const separated = separateAnalyticalScoreFromDownstream({
    analyticalScore: 82,
    archetypeScore: 64,
  });
  assert.equal(separated.F, 82);
  assert.equal(separated.R.state, "PASS");
  assert.equal(separated.archetype.affectsF, false);
});

test("crypto quote refresh moves current F up without a new authorization", () => {
  const next = publishQuoteRefreshScore({
    symbol: "BTC/USD",
    currentAnalyticalScore: 72,
    cryptoDecisionScore: 72,
    authorizedDecisionScore: 72,
    authorizedDecisionValid: true,
    centralReviewStatus: "NONE",
    scoreVersion: 3,
    centralAutonomousDecisionCore: { action: "ALLOW" },
  }, 79, { crypto: true });
  assert.equal(next.currentAnalyticalScore, 79);
  assert.equal(next.authorizedDecisionScore, 72);
  assert.equal(next.scoreVersion, 3);
  assert.equal(next.centralReviewStatus, "NONE");
});

test("crypto quote refresh moves current F down and revokes buy only when the requirement fails", () => {
  const next = publishQuoteRefreshScore({
    symbol: "BTC/USD",
    currentAnalyticalScore: 79,
    cryptoDecisionScore: 79,
    authorizedDecisionScore: 79,
    authorizedDecisionValid: true,
    scoreVersion: 4,
  }, 68, { crypto: true });
  assert.equal(next.currentAnalyticalScore, 68);
  assert.equal(next.authorizedDecisionScore, 79);
  assert.equal(next.scoreVersion, 4);
  const stillClearsLegacyGate = evaluateBuyable({
    authorizedDecisionValid: true,
    authorizedDecisionScore: next.authorizedDecisionScore,
    currentAnalyticalScore: next.currentAnalyticalScore,
    requiredF: CRYPTO_MIN_FINAL_SCORE_TO_BUY,
    entryApproved: true,
    S: 100,
  });
  assert.equal(CRYPTO_MIN_FINAL_SCORE_TO_BUY, 65);
  assert.equal(stillClearsLegacyGate.currentPass, true);
  assert.equal(stillClearsLegacyGate.buyable, true);
  const belowGate = publishQuoteRefreshScore({
    currentAnalyticalScore: 79,
    authorizedDecisionScore: 79,
    authorizedDecisionValid: true,
    scoreVersion: 4,
  }, 60, { crypto: true });
  assert.equal(belowGate.currentAnalyticalScore, 60);
  assert.equal(belowGate.authorizedDecisionScore, 79);
  const revoked = evaluateBuyable({
    authorizedDecisionValid: true,
    authorizedDecisionScore: belowGate.authorizedDecisionScore,
    currentAnalyticalScore: belowGate.currentAnalyticalScore,
    requiredF: CRYPTO_MIN_FINAL_SCORE_TO_BUY,
    entryApproved: true,
    S: 100,
  });
  assert.equal(revoked.buyable, false);
  assert.equal(revoked.reason, "CURRENT_ANALYTICAL_SCORE_BELOW_THRESHOLD");
});

test("a stale master score cannot replace a newer stock F", () => {
  assert.equal(getCanonicalFinalScore(analyticalStock), 81);
  const consumed = applyMasterConsumption(analyticalStock, { finalScore: 73, finalSizingMultiplier: 1 });
  assert.equal(consumed.currentAnalyticalScore, 81);
  assert.equal(consumed.stockDecisionScore, 81);
  assert.equal(consumed.masterFinalScore, 73);
  assert.equal(consumed.finalMasterDecisionProfile.finalScore, 81);
  assert.equal(consumed.finalMasterDecisionProfile.rewritesAnalyticalScore, false);
  assert.equal(consumed.score, 55);
  assert.equal(consumed.legacySignalScore, 55);
  assert.equal(consumed.runnerScore, 12);
});

test("a missing canonical stock F stays null", () => {
  const missing = {
    symbol: "AAPL",
    stockDecisionScore: null,
    currentAnalyticalScore: null,
    stockDecisionScoreAvailable: false,
    masterFinalScore: 73,
  };
  assert.equal(getCanonicalFinalScore(missing), null);
  const consumed = applyMasterConsumption(missing, { finalScore: 0 });
  assert.equal(consumed.stockDecisionScore, null);
  assert.equal(consumed.currentAnalyticalScore, null);
  assert.equal(consumed.finalMasterDecisionProfile.finalScore, null);
  assert.notEqual(consumed.finalMasterDecisionProfile.finalScore, 0);
  assert.equal(getCanonicalFinalScore({
    ...missing,
    stockDecisionScore: consumed.stockDecisionScore,
    currentAnalyticalScore: consumed.currentAnalyticalScore,
  }), null);
});

test("legacy runner and momentum fields do not change canonical F", () => {
  assert.equal(getCanonicalFinalScore({ ...analyticalStock, runnerScore: 99 }), 81);
  assert.equal(getCanonicalFinalScore({ ...analyticalStock, legacyMomentumScore: 10 }), 81);
  assert.equal(getCanonicalFinalScore({ ...analyticalStock, legacySignalScore: 10, score: 10 }), 81);
});

test("risk, execution, and size fields do not change canonical F", () => {
  const changed = {
    ...analyticalStock,
    opportunityLayers: {
      C: { state: "WAIT" },
      X: { state: "REJECT" },
      R: { state: "REJECT" },
      S: { amount: 0 },
    },
    riskDecision: { state: "REJECT", reasons: ["FAKE_BREAKOUT"] },
  };
  assert.equal(getCanonicalFinalScore(changed), 81);
});

test("installing a central decision updates authorization and leaves the analytical snapshot alone", () => {
  const components = {
    discovery: { score: 82, coverage: 1, configuredWeight: 1, measuredWeight: 1, state: "PASS" },
  };
  const weights = { discovery: 1 };
  const snapshot = buildCurrentAnalyticalSnapshot({
    components,
    weights,
    F: 82,
    coverage: 1,
    now: "2026-09-25T12:00:00.000Z",
  });
  assert.equal(reproduceFinalScore(snapshot), 82);
  const signal = {
    symbol: "BTC/USD",
    currentAnalyticalSnapshot: snapshot,
    analyticalHistory: [snapshot],
    currentAnalyticalScore: 82,
    scoreVersion: 2,
  };
  installCentralDecision(signal, {
    action: "BLOCK",
    finalDecisionScore: 64,
    cryptoDecisionScore: 82,
    cryptoDecisionEvidence: { analysisEvidencePass: true, coreEvidencePass: true, score: 82 },
    riskDecision: { state: "REJECT", reasons: ["FAKE_BREAKOUT"], affectsF: false },
  }, { crypto: true, now: Date.parse("2026-09-25T12:05:00.000Z") });
  assert.equal(signal.currentAnalyticalSnapshot.F, 82);
  assert.equal(signal.analyticalHistory[0].F, 82);
  assert.equal(reproduceFinalScore(signal.analyticalHistory[0]), 82);
  assert.equal(signal.authorizedDecisionScore, 82);
  assert.equal(signal.scoreVersion, 3);
  assert.equal(signal.cryptoDecisionScore, 82);
  assert.notEqual(signal.cryptoDecisionScore, 64);
});

test("stock layers keep F and put a fake breakout on risk", () => {
  const layers = buildStockOpportunityLayers({
    symbol: "XYZ",
    currentAnalyticalScore: 82,
    stockDecisionScore: 82,
    discoveryScore: 87,
    entryQualityScore: 80,
    entryQualityScorecard: { approved: true, score: 80, coverage: 1 },
    setupState: "FRESH_BREAKOUT",
    confirmations: { fakeBreakout: true, newsRiskAvailable: true },
  }, {
    requiredF: 70,
    eligibility: {
      quoteAgeSeconds: 1,
      quoteSourceApproved: true,
      quoteFreshnessPass: true,
      spreadAvailable: true,
      spreadTooWide: false,
      spreadAgeSeconds: 1,
      spreadSourceApproved: true,
      spreadFreshnessPass: true,
      centralDecisionPass: true,
      finalScoreAvailable: true,
      finalScore: 82,
    },
  });
  assert.equal(layers.F, 82);
  assert.equal(layers.analyticalPass, true);
  assert.equal(layers.R.state, "REJECT");
  assert.ok(layers.R.reasons.includes("FAKE_BREAKOUT"));
  assert.equal(layers.analyticalReasons.includes("FAKE_BREAKOUT"), false);
  const report = finalizeStockOpportunityLayers(layers, 100, {
    authorizedDecisionValid: true,
    authorizedDecisionScore: 82,
    currentAnalyticalScore: 82,
    entryApproved: true,
  });
  assert.equal(report.F, 82);
  assert.equal(report.buyable, false);
  assert.equal(report.blockedBy, "R");
});

test("the central crypto decision no longer publishes the lower of F and the archetype score", () => {
  const source = fs.readFileSync(new URL("../server.js", import.meta.url), "utf8");
  assert.equal(source.includes("Math.min(cryptoDecisionEvidence.score, archetypeDecision.finalDecisionScore)"), false);
  assert.equal(source.includes("separateAnalyticalScoreFromDownstream"), true);
  const engine = fs.readFileSync(new URL("../engine/createEngineCycle.js", import.meta.url), "utf8");
  assert.equal(engine.includes("matchingSignal.stockDecisionScore =\n            finalMasterDecisionProfile.finalScore"), false);
  assert.equal(engine.includes("applyMasterConsumption"), true);
});
