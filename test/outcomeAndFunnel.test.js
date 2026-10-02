import test from "node:test";
import assert from "node:assert/strict";
import { finalScoreBucket } from "../scoring/stockScoreOutcomeTracker.js";
import { buildCandidateFunnel, stockLongOrderAllowed } from "../scoring/candidateFunnel.js";
import { normalizeSignalScoreCompleteness } from "../scoring/signalScoreCompleteness.js";
import fs from "node:fs";

test("outcome bands are five-point F buckets and ignore a stale master score label", () => {
  assert.equal(finalScoreBucket(52), "F50-54");
  assert.equal(finalScoreBucket(70), "F70-74");
  assert.equal(finalScoreBucket(72), "F70-74");
  assert.equal(finalScoreBucket(86), "F85+");
  assert.equal(finalScoreBucket(null), "F_UNKNOWN");
  const source = fs.readFileSync(new URL("../scoring/stockScoreOutcomeTracker.js", import.meta.url), "utf8");
  assert.match(source, /fiveMinute/);
  assert.match(source, /fifteenMinute/);
  assert.match(source, /thirtyMinute/);
  assert.doesNotMatch(source, /score >= 72/);
  assert.match(source, /currentAnalyticalScore/);
});

test("a rejection funnel names the first blocker and keeps later prices empty until measured", () => {
  const row = buildCandidateFunnel({
    symbol: "XYZ",
    discoveryScore: 80,
    entryQualityScore: 70,
    currentAnalyticalScore: 74,
    decisionCoverage: 0.92,
    maximumPossibleF: 81,
    technicalEvidenceReady: true,
    executionReady: false,
    price: 20,
    firstSeenAt: "2026-09-25T14:00:00.000Z",
  });
  assert.equal(row.blocker, "ENTRY_THRESHOLD");
  assert.equal(row.finalScore, 74);
  assert.equal(row.buyable, false);
  assert.equal(row.priceAtRejection, 20);
  assert.equal(row.laterPrices.m15, null);
});

test("production normalization retains per-symbol rejection transitions", () => {
  const first = normalizeSignalScoreCompleteness({
    symbol: "XYZ",
    discoveryScorecard: { score: 82 },
    entryQualityScore: 68,
    entryQualityScorecard: { approved: false },
    stockDecisionScore: 74,
    currentAnalyticalScore: 74,
    technicalEvidenceReady: true,
    price: 20,
  });
  assert.equal(first.candidateFunnel.stage, "ENTRY_THRESHOLD");
  assert.equal(first.candidateFunnel.history.length, 1);

  const recovered = normalizeSignalScoreCompleteness({
    ...first,
    entryQualityScorecard: { approved: true },
    authorizedDecisionValid: true,
    opportunityLayers: {
      C: { state: "PASS" },
      X: { state: "PASS" },
      R: { state: "PASS" },
      S: { amount: 25 },
    },
    finalApprovedTradeAmount: 25,
    executionReady: true,
    riskApproved: true,
    buyableNow: true,
  });
  assert.equal(recovered.candidateFunnel.status, "BUYABLE");
  assert.equal(recovered.candidateFunnel.history.length, 2);
  assert.equal(recovered.candidateFunnel.history[0].stage, "ENTRY_THRESHOLD");
  assert.equal(recovered.candidateFunnel.history[1].status, "BUYABLE");
});

test("the per-symbol funnel exposes authorization and C X R S blockers in order", () => {
  const base = {
    symbol: "XYZ", discoveryScore: 80, technicalEvidenceReady: true,
    entryApproved: true, currentAnalyticalScore: 74,
  };
  assert.equal(buildCandidateFunnel(base).stage, "AUTHORIZATION");
  assert.equal(buildCandidateFunnel({ ...base, authorizedDecisionValid: true }).stage, "EVIDENCE_READY");
  const C = { ...base, authorizedDecisionValid: true, opportunityLayers: { C: { state: "PASS" } } };
  assert.equal(buildCandidateFunnel(C).stage, "EXECUTION_READY");
  const X = { ...C, opportunityLayers: { ...C.opportunityLayers, X: { state: "PASS" } } };
  assert.equal(buildCandidateFunnel(X).stage, "RISK_APPROVED");
  const R = { ...X, opportunityLayers: { ...X.opportunityLayers, R: { state: "PASS" } } };
  assert.equal(buildCandidateFunnel(R).stage, "SIZED");
});

test("a stock-long order must pass entry, F, authorization, and C X R S", () => {
  const blocked = stockLongOrderAllowed({
    entryApproved: true,
    finalScore: 74,
    authorized: false,
    C: "PASS",
    X: "PASS",
    R: "PASS",
    S: 100,
  });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.blocker, "authorization");
  const open = stockLongOrderAllowed({
    entryApproved: true,
    finalScore: 74,
    authorized: true,
    C: "PASS",
    X: "PASS",
    R: "PASS",
    S: 25,
  });
  assert.equal(open.allowed, true);
  assert.equal(open.requiredFinalScore, 70);
  const server = fs.readFileSync(new URL("../server.js", import.meta.url), "utf8");
  assert.doesNotMatch(server, /minimumScore: 85/);
});
