import test from "node:test";
import assert from "node:assert/strict";
import { createInitialEngineState } from "../state/initialEngineState.js";

test("creates isolated complete engine state instances", () => {
  const first = createInitialEngineState({ effectiveMode: "smart", maxRotationsPerDay: 9 });
  const second = createInitialEngineState();
  assert.equal(first.running, false);
  assert.equal(first.effectiveMode, "smart");
  assert.equal(first.maxRotationsPerDay, 9);
  assert.deepEqual(first.tradeJournalState, {
    totalClosedTrades: 0, winningTrades: 0, losingTrades: 0, breakevenTrades: 0,
    totalProfitPercent: 0, averageProfitPercent: 0, winRate: 0,
    bestTrade: null, worstTrade: null, lastUpdated: null,
  });
  first.lastSignals.push({ symbol: "AAPL" });
  assert.deepEqual(second.lastSignals, []);
});
