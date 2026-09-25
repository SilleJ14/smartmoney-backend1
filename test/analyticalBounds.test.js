import test from "node:test";
import assert from "node:assert/strict";
import {
  aggregateMeasuredComponents,
  buildMeasuredComponent,
  computeAnalyticalBounds,
} from "../scoring/measuredComponent.js";
import { applyAnalyticalScoreUpdate, requestCentralAuthorization } from "../scoring/analyticalAuthorization.js";
import { buildStockDecisionScore } from "../scoring/decisionScores.js";
import { evidencePriority } from "../discovery/evidencePriority.js";

function piece(name, score, weight, extras = {}) {
  return buildMeasuredComponent({
    componentName: name,
    score,
    coverage: extras.coverage ?? (score === null || score === undefined ? 0 : 1),
    configuredWeight: weight,
    minimumCoverage: name === "riskPortfolio" ? 0.6 : 0.5,
    unreadCeiling: extras.unreadCeiling,
    unreadFloor: extras.unreadFloor,
  });
}

function stockBook(specs) {
  const weights = {
    discovery: 0.32,
    entry: 0.42,
    marketContext: 0.09,
    riskPortfolio: 0.09,
    fundamentals: 0.08,
  };
  return Object.entries(weights).map(([name, weight]) => piece(name, specs[name]?.score ?? null, weight, specs[name] || {}));
}

test("partial entry coverage uses the measured score and the unread ceiling", () => {
  const bounds = computeAnalyticalBounds({
    components: stockBook({
      entry: { score: 80, coverage: 0.5, unreadCeiling: 55 },
    }),
    requiredFinalScore: 70,
    entry: { score: 80, coverage: 0.5, unreadCeiling: 55, required: 75 },
  });
  assert.equal(bounds.maximumPossibleEntryScore, 67.5);
  assert.equal(bounds.minimumPossibleEntryScore, 40);
  assert.equal(bounds.maximumPossibleScore, 86.35);
  assert.equal(bounds.entryScoreReachable, false);
  assert.equal(bounds.analyticalPassReachable, false);
});

test("F can still clear 70 while the entry gate cannot", () => {
  const bounds = computeAnalyticalBounds({
    components: stockBook({
      discovery: { score: 100 },
      entry: { unreadCeiling: 35 },
      marketContext: { score: 100 },
      riskPortfolio: { score: 100 },
      fundamentals: { score: 100 },
    }),
    requiredFinalScore: 70,
    entry: { score: null, coverage: 0, unreadCeiling: 35, required: 75 },
  });
  assert.equal(bounds.maximumPossibleScore, 72.7);
  assert.equal(bounds.maximumPossibleEntryScore, 35);
  assert.equal(bounds.finalScoreReachable, true);
  assert.equal(bounds.entryScoreReachable, false);
  assert.equal(bounds.analyticalPassReachable, false);
  assert.equal(bounds.recommendedAction, "ABANDON_CURRENT_MODEL");
  assert.equal(bounds.actionReason, "ENTRY_SCORE_UNREACHABLE");
});

test("an unreachable final score abandons the current model", () => {
  const bounds = computeAnalyticalBounds({
    components: stockBook({
      discovery: { score: 55 },
      entry: { unreadCeiling: 55 },
      marketContext: { score: 100 },
      riskPortfolio: { score: 100 },
      fundamentals: { score: 100 },
    }),
    requiredFinalScore: 70,
    entry: { score: null, coverage: 0, unreadCeiling: 55, required: 75 },
  });
  assert.equal(bounds.maximumPossibleScore, 66.7);
  assert.equal(bounds.finalScoreReachable, false);
  assert.equal(bounds.recommendedAction, "ABANDON_CURRENT_MODEL");
  assert.equal(bounds.actionReason, "FINAL_SCORE_UNREACHABLE");
});

test("a guaranteed final score needs no more evidence for F", () => {
  const bounds = computeAnalyticalBounds({
    components: stockBook({
      discovery: { score: 78 },
      entry: { score: 78 },
      marketContext: { score: 78 },
      riskPortfolio: { score: 78 },
      fundamentals: { unreadFloor: 3 },
    }),
    requiredFinalScore: 70,
    entry: { score: 78, coverage: 1, required: 75 },
  });
  assert.equal(bounds.currentScore, 78);
  assert.equal(bounds.minimumPossibleScore, 72);
  assert.equal(bounds.finalScoreGuaranteed, true);
  assert.equal(bounds.decisionBoundaryDistance, 2);
  assert.equal(bounds.recommendedAction, "EVIDENCE_SUFFICIENT");
  assert.equal(bounds.actionReason, "ANALYTICAL_GATES_GUARANTEED");
});

test("guaranteed F still collects mandatory fundamentals", () => {
  const bounds = computeAnalyticalBounds({
    components: stockBook({
      discovery: { score: 80 },
      entry: { score: 80 },
      marketContext: { score: 70 },
      riskPortfolio: { score: 70 },
    }),
    requiredFinalScore: 70,
    entry: { score: 80, coverage: 1, required: 75 },
    mandatoryEvidenceMissing: ["FUNDAMENTALS_UNKNOWN"],
  });
  assert.equal(bounds.currentScore, 78.04);
  assert.equal(bounds.minimumPossibleScore, 71.8);
  assert.equal(bounds.maximumPossibleScore, 79.8);
  assert.equal(bounds.remainingScoreDelta, 1.76);
  assert.equal(bounds.remainingUpside, 1.76);
  assert.equal(bounds.finalScoreGuaranteed, true);
  assert.equal(bounds.analyticalPassGuaranteed, false);
  assert.equal(bounds.recommendedAction, "COLLECT_EVIDENCE");
  assert.equal(bounds.actionReason, "FUNDAMENTALS_REQUIRED_BY_C");
});

test("an independently eligible alternate model replaces an impossible one", () => {
  const bounds = computeAnalyticalBounds({
    components: stockBook({
      discovery: { score: 64 },
      entry: { score: 64 },
      marketContext: { score: 64 },
      riskPortfolio: { score: 64 },
      fundamentals: { score: 64 },
    }),
    requiredFinalScore: 70,
    entry: { score: 64, coverage: 1, required: 75 },
    alternateModels: [{
      name: "CONTINUATION",
      eligible: true,
      maximumPossibleScore: 78,
      maximumPossibleEntryScore: 80,
      requiredEntryScore: 75,
    }],
  });
  assert.equal(bounds.maximumPossibleScore, 64);
  assert.equal(bounds.recommendedAction, "SWITCH_SETUP_MODEL");
  assert.equal(bounds.actionReason, "ALTERNATE_SETUP_REACHABLE");
  assert.equal(bounds.alternateModel, "CONTINUATION");
});

test("an ineligible alternate does not raise the ceiling", () => {
  const shared = {
    components: stockBook({
      discovery: { score: 64 },
      entry: { score: 64 },
      marketContext: { score: 64 },
      riskPortfolio: { score: 64 },
      fundamentals: { score: 64 },
    }),
    requiredFinalScore: 70,
    entry: { score: 64, coverage: 1, required: 75 },
  };
  const ineligible = computeAnalyticalBounds({
    ...shared,
    alternateModels: [{
      name: "CONTINUATION",
      eligible: false,
      maximumPossibleScore: 90,
      maximumPossibleEntryScore: 90,
    }],
  });
  const unreachable = computeAnalyticalBounds({
    ...shared,
    alternateModels: [{
      name: "BREAKOUT",
      eligible: true,
      maximumPossibleScore: 60,
      maximumPossibleEntryScore: 90,
    }],
  });
  assert.equal(ineligible.recommendedAction, "ABANDON_CURRENT_MODEL");
  assert.equal(unreachable.recommendedAction, "ABANDON_CURRENT_MODEL");
});

test("a negative remaining score delta is stored and does not cross the gate", () => {
  const bounds = computeAnalyticalBounds({
    components: stockBook({
      discovery: { score: 80 },
      entry: { unreadCeiling: 55 },
    }),
    requiredFinalScore: 70,
    entry: { score: null, coverage: 0, unreadCeiling: 55, required: 75 },
  });
  assert.equal(bounds.currentScore, 80);
  assert.equal(bounds.maximumPossibleScore, 74.7);
  assert.equal(bounds.remainingScoreDelta, -5.3);
  assert.equal(bounds.remainingUpside, 0);
  const updated = applyAnalyticalScoreUpdate(
    { currentAnalyticalScore: 68, authorizedDecisionValid: false, centralReviewStatus: "NONE" },
    80,
    { remainingScoreDelta: bounds.remainingScoreDelta }
  );
  assert.equal(updated.centralReviewStatus, "NONE");
  assert.notEqual(updated.reviewTrigger, "THRESHOLD_CROSS");
  assert.equal(updated.analyticalImprovement, false);
  assert.equal(updated.scoreRiseReason, "SCORE_ABOVE_COMPLETION_CEILING");
  assert.equal(updated.scoreVelocity, 0);
  assert.equal(requestCentralAuthorization(updated).requested, false);
});

test("runner weight zero changes neither score nor bounds", () => {
  const context = { score: null };
  const withoutRunner = aggregateMeasuredComponents([
    piece("base", 90, 0.45),
    piece("execution", 90, 0.40),
    piece("strategyEvolution", context.score, 0.15),
  ]);
  const withRunner = aggregateMeasuredComponents([
    piece("base", 90, 0.45),
    piece("execution", 90, 0.40),
    piece("runner", 100, 0),
    piece("strategyEvolution", context.score, 0.15),
  ]);
  assert.equal(withRunner.configuredWeight, 1);
  assert.equal(withRunner.score, 90);
  assert.equal(withRunner.coverage, 0.85);
  assert.equal(withRunner.score, withoutRunner.score);
  assert.equal(withRunner.maximumPossibleF, withoutRunner.maximumPossibleF);
  assert.equal(withRunner.minimumPossibleF, withoutRunner.minimumPossibleF);
});

test("an unknown component without a special ceiling can still reach 100", () => {
  const bounds = computeAnalyticalBounds({
    components: stockBook({
      discovery: { score: 55 },
    }),
    requiredFinalScore: 70,
    entry: { score: null, coverage: 0, required: 75 },
  });
  const entry = bounds && stockBook({ discovery: { score: 55 } }).find((item) => item.componentName === "entry");
  assert.equal(entry.unreadCeiling, 100);
  assert.equal(bounds.maximumPossibleScore, 85.6);
  assert.equal(bounds.maximumPossibleEntryScore, 100);
  assert.equal(bounds.finalScoreReachable, true);
});

test("a measured bad component stays locked below its ceiling", () => {
  const bounds = computeAnalyticalBounds({
    components: stockBook({
      discovery: { score: 100 },
      entry: { score: 20, unreadCeiling: 100 },
      marketContext: { score: 100 },
      riskPortfolio: { score: 100 },
      fundamentals: { score: 100 },
    }),
    requiredFinalScore: 70,
    entry: { score: 20, coverage: 1, unreadCeiling: 100, required: 75 },
  });
  assert.equal(bounds.currentScore, 66.4);
  assert.equal(bounds.maximumPossibleScore, 66.4);
  assert.equal(bounds.maximumPossibleEntryScore, 20);
  assert.equal(bounds.remainingScoreDelta, 0);
  assert.equal(bounds.recommendedAction, "ABANDON_CURRENT_MODEL");
});

test("stale measurements rescore only while the analytical gates remain reachable", () => {
  const reachable = computeAnalyticalBounds({
    components: stockBook({
      discovery: { score: 80 },
      entry: { score: 80 },
      marketContext: { score: 70 },
      riskPortfolio: { score: 70 },
    }),
    requiredFinalScore: 70,
    entry: { score: 80, coverage: 1, required: 75 },
    mandatoryEvidenceMissing: ["FUNDAMENTALS_UNKNOWN"],
    evidenceStale: true,
    staleReason: "PRICE_DRIFT",
  });
  const impossible = computeAnalyticalBounds({
    components: stockBook({
      discovery: { score: 100 },
      entry: { unreadCeiling: 35 },
      marketContext: { score: 100 },
      riskPortfolio: { score: 100 },
      fundamentals: { score: 100 },
    }),
    requiredFinalScore: 70,
    entry: { score: null, coverage: 0, unreadCeiling: 35, required: 75 },
    evidenceStale: true,
    staleReason: "NEW_BARS",
  });
  assert.equal(reachable.recommendedAction, "RESCORE");
  assert.equal(reachable.actionReason, "PRICE_DRIFT");
  assert.equal(impossible.recommendedAction, "ABANDON_CURRENT_MODEL");
});

test("the stock card collects required fundamentals after F is already guaranteed", () => {
  const decision = buildStockDecisionScore({
    discoveryScorecard: { score: 80, buyScore: 80, coverage: 1, canonicalExtensionEvidencePass: true },
    entryQualityScorecard: { score: 80, coverage: 1, approved: true },
    contextScore: 70,
    riskPortfolioScore: 70,
    fundamentalDataValid: false,
  });
  assert.equal(decision.score, 78.04);
  assert.equal(decision.analyticalBounds.minimumPossibleScore, 71.8);
  assert.equal(decision.analyticalBounds.finalScoreGuaranteed, true);
  assert.equal(decision.analyticalBounds.recommendedAction, "COLLECT_EVIDENCE");
  assert.equal(decision.analyticalBounds.actionReason, "FUNDAMENTALS_REQUIRED_BY_C");
});

test("a real rise under the completion ceiling still requests authorization", () => {
  const updated = applyAnalyticalScoreUpdate(
    { currentAnalyticalScore: 68, authorizedDecisionValid: false, centralReviewStatus: "NONE" },
    74,
    { remainingScoreDelta: 4 }
  );
  assert.equal(updated.centralReviewStatus, "QUEUED");
  assert.equal(updated.reviewTrigger, "THRESHOLD_CROSS");
  assert.equal(updated.analyticalImprovement, true);
});

test("extended partial entry on the stock card uses the unread ceiling", () => {
  const decision = buildStockDecisionScore({
    setupState: "EXTENDED",
    discoveryScorecard: { score: 80, buyScore: 80, coverage: 1, canonicalExtensionEvidencePass: true },
    entryQualityScorecard: { score: 55, rawScore: 80, coverage: 0.5, gates: ["ENTRY_EXTENDED"] },
    contextScore: 70,
    riskPortfolioScore: 70,
    fundamentalDataValid: false,
  });
  const entry = decision.components.find((item) => item.name === "entry");
  assert.equal(entry.value, 80);
  assert.equal(decision.analyticalBounds.maximumPossibleEntryScore, 67.5);
  assert.equal(decision.analyticalBounds.entryScoreReachable, false);
  assert.equal(decision.analyticalBounds.recommendedAction, "ABANDON_CURRENT_MODEL");
});

test("an abandoned model loses evidence priority while a boundary candidate keeps it", () => {
  const abandoned = evidencePriority({
    symbol: "AAA",
    discoveryScore: 80,
    currentAnalyticalScore: 80,
    decisionCoverage: 0.32,
    maximumPossibleF: 74.7,
    scoreVelocity: 4,
    analyticalBounds: {
      recommendedAction: "ABANDON_CURRENT_MODEL",
      analyticalPassReachable: false,
      remainingScoreDelta: -5.3,
    },
  });
  const uncertain = evidencePriority({
    symbol: "BBB",
    discoveryScore: 80,
    currentAnalyticalScore: 68,
    decisionCoverage: 0.92,
    maximumPossibleF: 82,
    analyticalBounds: {
      recommendedAction: "COLLECT_EVIDENCE",
      analyticalPassReachable: true,
      decisionBoundaryDistance: 0,
      finalScoreGuaranteed: false,
      remainingScoreDelta: 14,
    },
  });
  assert.ok(uncertain.priority > abandoned.priority);
  assert.ok(abandoned.reasons.includes("ABANDON_CURRENT_MODEL"));
  assert.equal(abandoned.reasons.includes("SCORE_VELOCITY"), false);
  assert.ok(uncertain.reasons.includes("COLLECT_EVIDENCE"));
});
