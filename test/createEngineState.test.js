import test from "node:test";
import assert from "node:assert/strict";
import { createEngineState } from "../state/createEngineState.js";

test("hydrates persisted state while resetting process-local fields", () => {
  let canonicalized = false;
  const state = createEngineState({
    defaults: { score: 0, cachedPositions: [1] },
    persisted: { score: 88, running: true, cachedAccount: { id: 1 }, lastError: "old" },
    canonicalize: () => { canonicalized = true; },
  });
  assert.equal(state.score, 88);
  assert.equal(state.running, false);
  assert.deepEqual(state.cachedPositions, []);
  assert.equal(state.cachedAccount, null);
  assert.equal(state.lastError, null);
  assert.equal(canonicalized, true);
});
