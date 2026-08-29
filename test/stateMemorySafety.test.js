import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  compactLiveEngineStateHistories,
  compactPersistedEngineStateSnapshot,
} from "../state/compactEngineState.js";
import { loadPersistedEngineState } from "../state/loadEngineState.js";
import { buildMemoryGuardSnapshot } from "../state/memoryGuard.js";
import { createEngineStateSaver } from "../state/saveEngineState.js";

function makeSignal(symbol, score = 80) {
  return {
    symbol,
    score,
    price: 10,
    percentChange: 2,
    chartBars: Array.from({ length: 100 }, (_, index) => ({
      t: index,
      o: 10,
      h: 11,
      l: 9,
      c: 10.5,
      v: 1000,
    })),
    historicalBars: Array.from({ length: 100 }, (_, index) => ({
      t: index,
      o: 10,
      h: 11,
      l: 9,
      c: 10.5,
      v: 1000,
    })),
    deeplyNestedTelemetry: { phases: Array(50).fill({ score, reason: "test" }) },
  };
}

test("compacts duplicated histories while preserving critical trading and learning state", () => {
  const critical = {
    highWaterMarks: { AAPL: 210 },
    aiEntryScores: { AAPL: { score: 88 } },
    aiManagedSymbols: ["AAPL"],
    liveTradeLimitState: { dateKey: "2026-08-25", intradayStockEntriesToday: 2 },
    multiTimeframeCryptoMemory: {
      "BTC/USD": { continuationSessions: [{ dayKey: "2026-08-24", close: 100 }] },
    },
    tradeJournalHistory: [{ symbol: "AAPL", profitPercent: 3 }],
  };
  const state = {
    ...critical,
    lastCryptoSignals: [makeSignal("BTC/USD")],
    explosiveRunnerHistory: Array.from({ length: 30 }, (_, index) => ({
      updatedAt: `2026-08-25T00:00:${String(index).padStart(2, "0")}Z`,
      reviewedCount: 25,
      topEarlyRunners: [makeSignal(`R${index}`)],
      runnerWatchlist: { top10: [makeSignal(`R${index}`)] },
    })),
    fullInstitutionalAiBrainHistory: Array.from({ length: 30 }, (_, index) => ({
      reviewedCount: 25,
      rankedOpportunities: [makeSignal(`B${index}`)],
    })),
    marketRegimeHistory: Array.from({ length: 80 }, (_, index) => ({ index })),
  };

  compactLiveEngineStateHistories(state);

  assert.equal(state.explosiveRunnerHistory.length, 20);
  assert.equal(state.fullInstitutionalAiBrainHistory.length, 20);
  assert.equal(state.marketRegimeHistory.length, 50);
  assert.equal("chartBars" in state.explosiveRunnerHistory[0].topEarlyRunners[0], false);
  assert.equal(state.lastCryptoSignals[0].chartBars.length, 100);
  assert.equal("historicalBars" in state.lastCryptoSignals[0], false);
  assert.deepEqual(state.highWaterMarks, critical.highWaterMarks);
  assert.deepEqual(state.aiEntryScores, critical.aiEntryScores);
  assert.deepEqual(state.aiManagedSymbols, critical.aiManagedSymbols);
  assert.deepEqual(state.liveTradeLimitState, critical.liveTradeLimitState);
  assert.deepEqual(state.multiTimeframeCryptoMemory, critical.multiTimeframeCryptoMemory);
  assert.deepEqual(state.tradeJournalHistory, critical.tradeJournalHistory);
});

test("persisted snapshot removes live caches and stays within a bounded size", () => {
  const state = {
    liveQuoteCache: { AAPL: makeSignal("AAPL") },
    liveMarketMemory: { AAPL: makeSignal("AAPL") },
    explosiveRunnerHistory: Array.from({ length: 100 }, (_, index) => ({
      reviewedCount: 25,
      topEarlyRunners: [makeSignal(`R${index}`)],
    })),
    signalHistory: Array.from({ length: 100 }, (_, index) => ({
      signalCount: 25,
      topSignals: [makeSignal(`S${index}`)],
    })),
  };
  const compact = compactPersistedEngineStateSnapshot(state);
  const bytes = Buffer.byteLength(JSON.stringify(compact));

  assert.deepEqual(compact.liveQuoteCache, {});
  assert.deepEqual(compact.liveMarketMemory, {});
  assert.equal(compact.explosiveRunnerHistory.length, 20);
  assert.equal(compact.signalHistory.length, 20);
  assert.ok(bytes < 100_000, `expected compact snapshot below 100 KB, received ${bytes}`);
});

test("state saver persists bounded stock and quiet-candidate learning history", async () => {
  const quietObservations = Array.from({ length: 650 }, (_, index) => ({
    id: `crypto:Q${index}:2026-08-20`,
    assetClass: "crypto",
    symbol: `Q${index}`,
    observedAt: index,
    baselinePrice: 100,
    trackingPeakPrice: 101,
    componentScores: { structure: 70 },
    scoringModelVersion: "SMARTMONEY_CRYPTO_DECISION_V3",
    marketRegime: "RISK_ON",
    liquidityBucket: "HIGH",
    marketCapBucket: "LARGE",
    benchmarks: { Bitcoin: { symbol: "BTCUSD", baselinePrice: 100 } },
    benchmarkMeasurements: { 1: { Bitcoin: 2 } },
    targets: { 1: "2026-08-21", 3: "2026-08-23", 5: "2026-08-25" },
    measurements: {},
  }));
  const state = {
    highWaterMarks: {},
    stockScoreOutcomeState: { observations: [{ id: "AAPL:2026-08-20" }] },
    stockScoreOutcomeLearning: { active: true, sampleCount: 30 },
    quietCandidateOutcomeState: {
      maxObservations: 650,
      observations: quietObservations,
    },
    quietCandidateOutcomeLearning: {
      stock: { active: false, sampleCount: 10 },
      crypto: { active: true, sampleCount: 30 },
    },
    cryptoQuietDiscoveryState: {
      topCandidates: Array.from({ length: 40 }, (_, index) => ({
        symbol: `C${index}`,
        chartBars: Array(100).fill({ c: 100 }),
      })),
    },
  };
  const saver = createEngineStateSaver({
    ENGINE_STATE_FILE: "unused.json",
    engineState: state,
    getEffectiveTradingMode: () => "smart",
    writeState: async () => {},
    saveDelayMs: 60_000,
  });

  const snapshot = saver.saveEngineState("PERSIST_SCORING_LEARNING");

  assert.equal(snapshot.quietCandidateOutcomeState.observations.length, 600);
  assert.equal(snapshot.quietCandidateOutcomeState.observations[0].marketRegime, "RISK_ON");
  assert.equal(snapshot.quietCandidateOutcomeState.observations[0].scoringModelVersion, "SMARTMONEY_CRYPTO_DECISION_V3");
  assert.equal(snapshot.quietCandidateOutcomeState.observations[0].benchmarkMeasurements[1].Bitcoin, 2);
  assert.equal(snapshot.quietCandidateOutcomeLearning.crypto.active, true);
  assert.equal(snapshot.stockScoreOutcomeLearning.sampleCount, 30);
  assert.equal(snapshot.cryptoQuietDiscoveryState.topCandidates.length, 25);
  assert.equal(
    "chartBars" in snapshot.cryptoQuietDiscoveryState.topCandidates[0],
    false
  );
  await saver.flushEngineStateSave();
});

test("state saver coalesces updates and never overlaps writes", async () => {
  const releases = [];
  const reasons = [];
  let activeWrites = 0;
  let maximumActiveWrites = 0;
  const writer = async (_file, snapshot) => {
    activeWrites += 1;
    maximumActiveWrites = Math.max(maximumActiveWrites, activeWrites);
    reasons.push(snapshot.reason);
    await new Promise((resolve) => releases.push(resolve));
    activeWrites -= 1;
  };
  const state = { highWaterMarks: {}, tradeJournalHistory: [] };
  const saver = createEngineStateSaver({
    ENGINE_STATE_FILE: "unused.json",
    engineState: state,
    getEffectiveTradingMode: () => "smart",
    writeState: writer,
    saveDelayMs: 60_000,
  });

  saver.saveEngineState("FIRST");
  const drain = saver.flushEngineStateSave();
  await new Promise((resolve) => setImmediate(resolve));
  saver.saveEngineState("SECOND");
  saver.saveEngineState("LATEST");
  void saver.flushEngineStateSave();

  assert.equal(activeWrites, 1);
  releases.shift()();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(activeWrites, 1);
  releases.shift()();
  await drain;

  assert.equal(maximumActiveWrites, 1);
  assert.deepEqual(reasons, ["FIRST", "LATEST"]);
  assert.equal(saver.getSaveStatus().completedWriteCount, 2);
  assert.equal(saver.getSaveStatus().writeInProgress, false);
});

test("loader backs up migratable state and archives state above the hard budget", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "smartmoney-state-"));
  try {
    const migratable = path.join(directory, "migratable.json");
    fs.writeFileSync(migratable, JSON.stringify({ highWaterMarks: { AAPL: 200 } }));
    const loaded = loadPersistedEngineState(migratable, {
      backupThresholdBytes: 1,
      maxLoadBytes: 10_000,
    });
    assert.deepEqual(loaded.highWaterMarks, { AAPL: 200 });
    assert.equal(fs.existsSync(`${migratable}.pre-memory-compaction`), true);

    const oversized = path.join(directory, "oversized.json");
    fs.writeFileSync(oversized, JSON.stringify({ payload: "x".repeat(500) }));
    assert.deepEqual(loadPersistedEngineState(oversized, { maxLoadBytes: 100 }), {});
    assert.equal(fs.existsSync(oversized), false);
    assert.equal(
      fs.readdirSync(directory).some((name) => name.startsWith("oversized.json.oversized-")),
      true
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("memory guard pauses heavy work before the configured hard limit", () => {
  const normal = buildMemoryGuardSnapshot(
    { rss: 500 * 1024 * 1024, heapUsed: 300, heapTotal: 400, external: 0 },
    { limitMb: 2048, softRatio: 0.72, hardRatio: 0.85 }
  );
  const elevated = buildMemoryGuardSnapshot(
    { rss: 1600 * 1024 * 1024, heapUsed: 300, heapTotal: 400, external: 0 },
    { limitMb: 2048, softRatio: 0.72, hardRatio: 0.85 }
  );
  const critical = buildMemoryGuardSnapshot(
    { rss: 1800 * 1024 * 1024, heapUsed: 300, heapTotal: 400, external: 0 },
    { limitMb: 2048, softRatio: 0.72, hardRatio: 0.85 }
  );

  assert.equal(normal.pressure, "normal");
  assert.equal(normal.shouldPauseHeavyWork, false);
  assert.equal(elevated.pressure, "elevated");
  assert.equal(elevated.shouldPauseHeavyWork, true);
  assert.equal(critical.pressure, "critical");
});
