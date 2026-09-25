import test from "node:test";
import assert from "node:assert/strict";
import {
  authorizeAnalyticalSnapshot,
  buildCurrentAnalyticalSnapshot,
  displayedComponent,
  publishCurrentAnalyticalSnapshot,
  reproduceFinalScore,
  selectDiscoveryInput,
} from "../scoring/analyticalSnapshot.js";
import { assessContinuationSetup } from "../scoring/continuationSetup.js";
import { buildDecisionScoreTelemetry, buildStockDecisionScore } from "../scoring/decisionScores.js";
import { buildStockOpportunityLayers } from "../scoring/opportunityLayers.js";
import { installCentralDecision } from "../scoring/installCentralDecision.js";

function continuationFixture() {
  const now = Date.now();
  const chartBars = Array.from({ length: 20 }, (_, index) => ({
    t: now - (20 - index) * 300000,
    o: 99,
    h: 104,
    l: 97,
    c: 100,
    v: 1000,
  }));
  chartBars.splice(-3, 3,
    { t: now - 900000, o: 99.5, h: 100, l: 99, c: 99.8, v: 2000 },
    { t: now - 600000, o: 99.8, h: 100.2, l: 99.4, c: 100, v: 2000 },
    { t: now - 300000, o: 100, h: 101.2, l: 99.8, c: 101, v: 2000 });
  return { symbol: "RUN", chartBars, price: 101, percentChange: 4, volume: 1000000 };
}

test("a measured continuation displays its continuation score as D, not the early card", () => {
  const row = continuationFixture();
  const continuation = assessContinuationSetup(row);
  assert.equal(continuation.eligible, true);
  const decision = buildStockDecisionScore({
    ...row,
    discoveryLane: "MEASURED_CONTINUATION",
    discoveryScorecard: { score: 55, buyScore: 55, coverage: 1, canonicalExtensionEvidencePass: true },
    entryQualityScorecard: { score: 80, coverage: 1, approved: true },
    contextScore: 70,
    riskPortfolioScore: 70,
    fundamentalBlendScore: 70,
    fundamentalDataValid: true,
    runnerScore: 91,
    legacyCompositeScore: 94,
  });
  const discovery = decision.currentAnalyticalSnapshot.components.discovery;
  assert.equal(discovery.source, "CONTINUATION_SETUP");
  assert.equal(discovery.score, continuation.score);
  assert.notEqual(discovery.score, 55);
  const phone = displayedComponent(decision.currentAnalyticalSnapshot, "discovery");
  assert.equal(phone.score, continuation.score);
  assert.notEqual(phone.score, 55);
  assert.equal(decision.currentAnalyticalSnapshot.diagnostics.earlyDiscoveryScore, 55);
  assert.equal(decision.currentAnalyticalSnapshot.diagnostics.runnerScore, 91);
  assert.equal(decision.currentAnalyticalSnapshot.diagnostics.boostedLegacyScore, 94);
  const layers = buildStockOpportunityLayers({
    currentAnalyticalSnapshot: decision.currentAnalyticalSnapshot,
    discoveryScore: 55,
    discoveryScorecard: { score: 55 },
    runnerScore: 91,
    currentAnalyticalScore: decision.score,
    entryQualityScore: 80,
    entryQualityScorecard: { approved: true, score: 80, coverage: 1 },
  });
  assert.equal(layers.D, continuation.score);
});

test("the phone reader returns continuation D 84 and never substitutes the early card, runner, or legacy score", () => {
  const selected = selectDiscoveryInput({
    measuredContinuationEligible: true,
    continuationScore: 84,
    earlyScore: 55,
    earlyBuyScore: 55,
  });
  assert.equal(selected.score, 84);
  assert.equal(selected.source, "CONTINUATION_SETUP");
  const snapshot = buildCurrentAnalyticalSnapshot({
    components: {
      discovery: { score: 84, source: "CONTINUATION_SETUP", coverage: 1, state: "PASS", measuredWeight: 0.32, configuredWeight: 0.32 },
      entry: { score: 81, source: "ENTRY_QUALITY", coverage: 1, state: "PASS", measuredWeight: 0.42, configuredWeight: 0.42 },
    },
    weights: { discovery: 0.32, entry: 0.42 },
    F: 82.29,
  });
  const phone = displayedComponent(snapshot, "discovery");
  assert.equal(phone.score, 84);
  assert.equal(phone.text, "84");
  assert.notEqual(phone.score, 55);
  assert.notEqual(phone.score, 91);
  assert.notEqual(phone.score, 94);
});

test("a non-continuation uses the early discovery score that entered F", () => {
  const decision = buildStockDecisionScore({
    discoveryScorecard: { score: 72, buyScore: 72, coverage: 1, canonicalExtensionEvidencePass: true, setupState: "EARLY" },
    entryQualityScorecard: { score: 80, coverage: 1, approved: true },
    contextScore: 70,
    riskPortfolioScore: 70,
    fundamentalBlendScore: 70,
    fundamentalDataValid: true,
    runnerScore: 99,
    legacyCompositeScore: 99,
  });
  assert.equal(decision.currentAnalyticalSnapshot.components.discovery.source, "EARLY_DISCOVERY");
  assert.equal(decision.currentAnalyticalSnapshot.components.discovery.score, 72);
  assert.equal(decision.currentAnalyticalSnapshot.setupModel === "MEASURED_CONTINUATION", false);
});

test("missing discovery displays an em dash and is not zero", () => {
  const selected = selectDiscoveryInput({ measuredContinuationEligible: false, earlyScore: null, earlyBuyScore: null });
  assert.equal(selected.score, null);
  assert.equal(selected.state, "DATA_UNAVAILABLE");
  const snapshot = buildCurrentAnalyticalSnapshot({
    components: { discovery: { score: null, source: "EARLY_DISCOVERY", coverage: 0, state: "DATA_UNAVAILABLE" } },
    weights: { discovery: 0.32 },
    F: null,
  });
  const phone = displayedComponent(snapshot, "discovery");
  assert.equal(phone.score, null);
  assert.equal(phone.text, "—");
  assert.notEqual(phone.score, 0);
});

test("telemetry and the published signal use the canonical discovery value", () => {
  const row = continuationFixture();
  const continuation = assessContinuationSetup(row);
  const signal = {
    ...row,
    discoveryLane: "MEASURED_CONTINUATION",
    discoveryScorecard: { score: 55, buyScore: 55, coverage: 1, canonicalExtensionEvidencePass: true },
    entryQualityScorecard: { score: 80, coverage: 1, approved: true },
    contextScore: 70,
    riskPortfolioScore: 70,
    fundamentalBlendScore: 70,
    fundamentalDataValid: true,
  };
  const telemetry = buildDecisionScoreTelemetry(signal);
  signal.decisionScoreTelemetry = telemetry;
  publishCurrentAnalyticalSnapshot(signal);
  assert.equal(telemetry.scores.discovery, continuation.score);
  assert.equal(telemetry.currentAnalyticalSnapshot.components.discovery.score, continuation.score);
  assert.equal(signal.discoveryScore, continuation.score);
  assert.equal(signal.earlyDiscoveryScore, 55);
  assert.notEqual(signal.discoveryScore, signal.earlyDiscoveryScore);
});

test("a new analytical revision does not increment the authorized score version", () => {
  const first = buildCurrentAnalyticalSnapshot({
    components: { discovery: { score: 77, source: "EARLY_DISCOVERY", coverage: 1, state: "PASS", measuredWeight: 1, configuredWeight: 1 } },
    weights: { discovery: 1 },
    F: 77,
  });
  const second = buildCurrentAnalyticalSnapshot({
    previous: first,
    components: { discovery: { score: 84, source: "CONTINUATION_SETUP", coverage: 1, state: "PASS", measuredWeight: 1, configuredWeight: 1 } },
    weights: { discovery: 1 },
    F: 84,
  });
  assert.equal(first.analyticalRevision, 1);
  assert.equal(second.analyticalRevision, 2);
  assert.equal(first.F, 77);
  assert.equal(second.F, 84);
  assert.equal(first.scoreVersion, undefined);
  assert.equal(second.scoreVersion, undefined);
  assert.throws(() => { first.components.discovery.score = 1; });
});

test("central install freezes the selected analytical snapshot and leaves a later revision alone", () => {
  const signal = {
    scoreVersion: 27,
    centralReviewStatus: "NONE",
    currentAnalyticalScore: 77,
    authorizedDecisionValid: false,
    discoveryScorecard: { score: 76, buyScore: 76, coverage: 1, canonicalExtensionEvidencePass: true },
    entryQualityScorecard: { score: 78, coverage: 1, approved: true },
    contextScore: 70,
    riskPortfolioScore: 70,
    fundamentalBlendScore: 70,
    fundamentalDataValid: true,
  };
  const first = buildStockDecisionScore(signal);
  signal.currentAnalyticalSnapshot = first.currentAnalyticalSnapshot;
  signal.stockDecisionEvidence = first;
  const installed = installCentralDecision(signal, {
    decisionRevision: 1,
    action: "ALLOW",
    finalDecisionScore: first.score,
    stockDecisionEvidence: first,
    provenance: "test",
  });
  assert.equal(installed.scoreVersion, 28);
  assert.equal(installed.authorizedDecisionSnapshot.scoreVersion, 28);
  assert.equal(installed.authorizedDecisionSnapshot.authorizedF, first.score);
  assert.equal(installed.authorizedDecisionSnapshot.authorizedComponents.discovery.score, first.currentAnalyticalSnapshot.components.discovery.score);
  const later = buildStockDecisionScore({
    ...signal,
    currentAnalyticalSnapshot: first.currentAnalyticalSnapshot,
    discoveryScorecard: { score: 90, buyScore: 90, coverage: 1, canonicalExtensionEvidencePass: true },
  });
  assert.equal(later.currentAnalyticalSnapshot.analyticalRevision, first.currentAnalyticalSnapshot.analyticalRevision + 1);
  assert.equal(installed.scoreVersion, 28);
  assert.equal(installed.authorizedDecisionSnapshot.authorizedF, first.score);
  assert.notEqual(later.score, first.score);
  assert.equal(reproduceFinalScore(installed.authorizedDecisionSnapshot), installed.authorizedDecisionSnapshot.authorizedF);
  assert.equal(reproduceFinalScore(later.currentAnalyticalSnapshot), later.currentAnalyticalSnapshot.F);
});
