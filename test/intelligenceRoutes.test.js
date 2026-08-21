import test from "node:test";
import assert from "node:assert/strict";
import { buildIntelligenceSnapshot } from "../routes/intelligenceRoutes.js";

test("intelligence snapshots cap histories without mutating state", () => {
  const history = Array.from({ length: 120 }, (_, index) => index);
  const state = { modelState: { score: 88 }, modelHistory: history };
  const snapshot = buildIntelligenceSnapshot(state, "modelState", "modelHistory");
  assert.equal(snapshot.modelState.score, 88);
  assert.equal(snapshot.modelHistory.length, 100);
  assert.equal(history.length, 120);
});
