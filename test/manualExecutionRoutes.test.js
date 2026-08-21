import test from "node:test";
import assert from "node:assert/strict";
import { clearClosedPositionState } from "../routes/manualExecutionRoutes.js";

test("manual close clears learned position state and starts cooldown", () => {
  const state = { symbolCooldowns: {}, highWaterMarks: { AAPL: 10 }, aiEntryScores: { AAPL: 90 }, runnerPositions: { AAPL: {} } };
  clearClosedPositionState(state, "AAPL", "now");
  assert.equal(state.symbolCooldowns.AAPL, "now");
  assert.equal(state.highWaterMarks.AAPL, undefined);
  assert.equal(state.aiEntryScores.AAPL, undefined);
  assert.equal(state.runnerPositions.AAPL, undefined);
});
