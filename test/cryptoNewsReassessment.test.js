import test from "node:test";
import assert from "node:assert/strict";
import { evaluateCryptoNewsReassessment } from "../scoring/cryptoNewsReassessment.js";

function result(overrides = {}) {
  return {
    newsEvidence: {
      providerState: "AVAILABLE",
      coverageState: "COVERED",
      catalystState: "PRESENT",
      adverseState: "CLEAR",
      newestCheckedAt: "2026-10-02T12:00:00.000Z",
      checkedAt: "2026-10-02T12:01:00.000Z",
      relevantArticles: 1,
      ...overrides,
    },
  };
}

test("new covered crypto news creates a priority reassessment", () => {
  const assessment = evaluateCryptoNewsReassessment("btc/usd", result());
  assert.equal(assessment.event.symbol, "BTC/USD");
  assert.equal(assessment.event.reassessmentPriority, 3);
  assert.match(assessment.event.reassessmentEvent, /^crypto-news:/);
});

test("unchanged news evidence does not repeatedly queue reassessment", () => {
  const first = evaluateCryptoNewsReassessment("BTC/USD", result());
  const unchanged = evaluateCryptoNewsReassessment("BTC/USD", result({
    checkedAt: "2026-10-02T12:05:00.000Z",
  }), first.current);
  assert.equal(unchanged.event, null);
});

test("a changed adverse state queues immediate reassessment", () => {
  const first = evaluateCryptoNewsReassessment("BTC/USD", result());
  const negative = evaluateCryptoNewsReassessment("BTC/USD", result({
    adverseState: "NEGATIVE",
    checkedAt: "2026-10-02T12:06:00.000Z",
  }), first.current);
  assert.equal(negative.event.reassessmentPriority, 3);
});
