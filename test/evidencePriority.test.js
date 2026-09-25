import test from "node:test";
import assert from "node:assert/strict";
import {
  allocateEvidenceSlots,
  evidencePriority,
  rankBeforeSlice,
  reconcileLiveMembership,
  refreshCachedEvidenceMembership,
  selectSubscriptionSymbols,
} from "../discovery/evidencePriority.js";
import { createIncrementalResearch } from "../discovery/incrementalResearch.js";
import { createEarlyCandidateReassessment } from "../discovery/earlyCandidateReassessment.js";
import { requestCentralAuthorization } from "../scoring/analyticalAuthorization.js";

const researched = (symbol, extra = {}) => ({
  symbol,
  researchEvidenceAt: new Date().toISOString(),
  chartBars: Array.from({ length: 24 }, () => ({ c: 10 })),
  centralAutonomousDecisionCore: { action: "ALLOW" },
  ...extra,
});

test("a stock near the buy gate outranks an earlier name that is far below it", () => {
  const far = evidencePriority({ symbol: "FAR", discoveryScore: 80, currentAnalyticalScore: 40 });
  const near = evidencePriority({ symbol: "NEAR", discoveryScore: 60, currentAnalyticalScore: 68 });
  assert.ok(near.priority > far.priority);
  assert.equal(near.distanceToQualification, 2);
  assert.ok(near.reasons.includes("NEAR_QUALIFICATION"));
});

test("news, breakout proximity, and time since evaluation each raise priority", () => {
  const now = Date.now();
  const quiet = evidencePriority({ symbol: "QUIET", discoveryScore: 60, currentAnalyticalScore: 50, price: 10, high: 12 }, { now });
  const news = evidencePriority({ symbol: "NEWS", discoveryScore: 60, currentAnalyticalScore: 50, hasNews: true, price: 10, high: 12 }, { now });
  const breakout = evidencePriority({ symbol: "BRK", discoveryScore: 60, currentAnalyticalScore: 50, price: 10, high: 10.1 }, { now });
  const stale = evidencePriority({
    symbol: "OLD", discoveryScore: 60, currentAnalyticalScore: 50, price: 10, high: 12,
    lastFullAssessment: new Date(now - 30 * 60000).toISOString(),
  }, { now });
  assert.ok(news.priority > quiet.priority);
  assert.ok(breakout.priority > quiet.priority);
  assert.ok(stale.priority > quiet.priority);
  assert.ok(stale.reasons.includes("EVALUATION_AGE"));
});

test("live evidence keeps one slot for a name that has never been fully evaluated", () => {
  const ranked = Array.from({ length: 20 }, (_, index) => ({
    symbol: `S${index}`,
    discoveryScore: 90 - index,
    currentAnalyticalScore: 60,
    lastFullAssessment: new Date().toISOString(),
    price: 10,
    high: 12,
  }));
  ranked.push({ symbol: "NEW", discoveryScore: 10, price: 10, high: 12 });
  const allocation = allocateEvidenceSlots(ranked, { watchlistSlots: 30, liveSlots: 15 });
  assert.equal(allocation.watchlist.length, 21);
  assert.equal(allocation.liveSymbols.includes("NEW"), true);
  assert.equal(allocation.liveSymbols.length, 15);
});

test("incremental research does not spend its batch on array order", () => {
  const now = Date.parse("2026-09-11T15:01:00Z");
  const reviewed = [];
  const research = createIncrementalResearch({
    now: () => now,
    batchSize: 1,
    review: (row) => row,
    publish: (rows) => reviewed.push(...rows),
  });
  const stamp = new Date(now).toISOString();
  const early = researched("EARLY", { discoveryScore: 90, currentAnalyticalScore: 40, researchEvidenceAt: stamp });
  const close = researched("CLOSE", { discoveryScore: 55, currentAnalyticalScore: 69, researchEvidenceAt: stamp });
  research.run([early, close]);
  assert.equal(reviewed[0].symbol, "CLOSE");
});

test("F70 leaves the near line and requests central authorization", () => {
  const near = evidencePriority({ symbol: "NEAR", discoveryScore: 60, currentAnalyticalScore: 69 });
  const crossed = evidencePriority({ symbol: "GATE", discoveryScore: 60, currentAnalyticalScore: 70 });
  assert.equal(near.nearLine, true);
  assert.equal(crossed.nearLine, false);
  assert.equal(crossed.authorizationRequired, true);
  assert.ok(near.priority > crossed.priority);
  const review = requestCentralAuthorization({ symbol: "GATE", currentAnalyticalScore: 70 });
  assert.equal(review.requested, true);
  assert.equal(review.centralReviewStatus, "QUEUED");
  assert.equal(review.reviewTrigger, "THRESHOLD_CROSS");
  const authorized = [];
  const researchedRows = [];
  const now = Date.parse("2026-09-11T15:01:00Z");
  const research = createIncrementalResearch({
    now: () => now,
    batchSize: 1,
    review: (row) => row,
    publish: (rows) => researchedRows.push(...rows),
    onAuthorization: (rows) => authorized.push(...rows),
  });
  const stamp = new Date(now).toISOString();
  research.run([
    researched("GATE", { discoveryScore: 60, currentAnalyticalScore: 70, researchEvidenceAt: stamp }),
    researched("NEAR", { discoveryScore: 60, currentAnalyticalScore: 69, researchEvidenceAt: stamp }),
  ]);
  assert.equal(researchedRows[0].symbol, "NEAR");
  assert.equal(authorized[0].symbol, "GATE");
});

test("a higher-priority arrival evicts the lowest queued name", async () => {
  const now = Date.parse("2026-09-25T14:00:00Z");
  const analyzed = [];
  let allow = false;
  const worker = createEarlyCandidateReassessment({
    now: () => now,
    capacity: 2,
    canRun: () => allow,
    analyze: async (symbols) => {
      analyzed.push(...symbols);
      return symbols.map((symbol) => ({ symbol }));
    },
    publish: () => true,
  });
  const low = (symbol) => ({ symbol, discoveryScore: 10, currentAnalyticalScore: 20 });
  await worker.run([low("LOW1"), low("LOW2")]);
  await worker.run([{ symbol: "HIGH", discoveryScore: 10, currentAnalyticalScore: 69 }]);
  assert.equal(worker.getStatus().evictedByPriority, 1);
  await worker.run([low("ALSO")]);
  assert.equal(worker.getStatus().deferredByCapacity, 1);
  allow = true;
  await worker.run();
  assert.equal(analyzed.includes("HIGH"), true);
  assert.equal(analyzed.includes("LOW2"), false);
});

test("news changes live membership without using the quiet-scan age", () => {
  const now = Date.parse("2026-09-25T15:00:00Z");
  const stamp = new Date(now - 60000).toISOString();
  const cached = ["A", "B", "C"].map((symbol, index) => ({
    symbol,
    discoveryScore: 80 - index * 20,
    currentAnalyticalScore: 40,
    lastFullAssessment: stamp,
    price: 10,
    high: 12,
  }));
  const state = {
    ok: true,
    updatedAt: "2026-09-25T14:00:00.000Z",
    cachedFeatures: cached,
    liveSymbols: ["A", "B"],
    evidenceAdmittedAt: { A: now, B: now },
  };
  const next = refreshCachedEvidenceMembership(state, [{ symbol: "C", hasNews: true, newsArrivedAt: new Date(now).toISOString() }], {
    now,
    watchlistSlots: 3,
    liveSlots: 2,
    minDwellMs: 15 * 60000,
  });
  assert.equal(next.cachedFeatures, cached);
  assert.equal(next.updatedAt, state.updatedAt);
  assert.equal(next.liveSymbols.includes("C"), true);
  assert.equal(cached[0].hasNews, undefined);
});

test("a small priority oscillation does not replace a live subscription", () => {
  const now = Date.parse("2026-09-25T15:00:00Z");
  const ranked = [
    { symbol: "A", evidencePriority: 50, evidencePriorityReasons: [] },
    { symbol: "C", evidencePriority: 49.4, evidencePriorityReasons: [] },
    { symbol: "B", evidencePriority: 49, evidencePriorityReasons: [] },
  ];
  const stable = reconcileLiveMembership(["A", "B"], ranked, {
    liveSlots: 2,
    margin: 2,
    minDwellMs: 60000,
    admittedAt: { A: now - 120000, B: now - 120000 },
    now,
  });
  assert.deepEqual(stable.liveSymbols, ["A", "B"]);
  const tradier = selectSubscriptionSymbols({
    ranked: [{ symbol: "A", priority: 50 }, { symbol: "B", priority: 50.4 }],
    incumbent: [{ symbol: "A", subscribedAt: new Date(now - 120000).toISOString() }],
    limit: 1,
    now,
  });
  assert.deepEqual(tradier, ["A"]);
});

test("a low-priority Tradier incumbent yields after its dwell to a clearly stronger name", () => {
  const now = Date.parse("2026-09-25T15:00:00Z");
  const ranked = [{ symbol: "LOW", priority: 10 }, { symbol: "HIGH", priority: 40 }];
  const incumbent = [{ symbol: "LOW", subscribedAt: new Date(now).toISOString() }];
  assert.deepEqual(selectSubscriptionSymbols({ ranked, incumbent, limit: 1, now: now + 1000 }), ["LOW"]);
  assert.deepEqual(selectSubscriptionSymbols({ ranked, incumbent, limit: 1, now: now + 61000 }), ["HIGH"]);
});

test("institutional candidates are ranked before the list is cut", () => {
  const picked = rankBeforeSlice([
    { symbol: "EARLY", score: 71 },
    { symbol: "LATE", score: 95 },
  ], { minScore: 70, limit: 1 });
  assert.equal(picked[0].symbol, "LATE");
});

test("memory pressure shrinks the live budget instead of keeping the previous 15", () => {
  const now = Date.parse("2026-09-25T15:00:00Z");
  const stamp = new Date(now).toISOString();
  const cached = Array.from({ length: 15 }, (_, index) => ({
    symbol: `S${String(index).padStart(2, "0")}`,
    discoveryScore: 20,
    currentAnalyticalScore: 40 + index,
    lastFullAssessment: stamp,
    price: 10,
    high: 12,
  }));
  const state = {
    ok: true,
    updatedAt: stamp,
    cachedFeatures: cached,
    liveSymbols: cached.map((row) => row.symbol),
    evidenceAdmittedAt: Object.fromEntries(cached.map((row) => [row.symbol, now - 120000])),
  };
  const next = refreshCachedEvidenceMembership(state, [], {
    now,
    memoryPressure: true,
    watchlistSlots: 30,
    liveSlots: 15,
  });
  assert.equal(next.cachedFeatures, cached);
  assert.equal(next.updatedAt, stamp);
  assert.equal(next.liveSymbols.length, 7);
  assert.equal(next.liveSymbols[0], "S14");
  assert.equal(next.liveSymbols.includes("S00"), false);
});
