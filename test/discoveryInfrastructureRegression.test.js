import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createDiscoveryFeatureStore } from "../discovery/featureStore.js";
import { createAutoBuyStrategies } from "../strategies/autoBuyStrategies.js";
import { calculateQuietCandidateLearning, updateQuietCandidateOutcomes } from "../scoring/quietCandidateOutcomeTracker.js";
import { compactLiveEngineStateHistories } from "../state/compactEngineState.js";
import { buildProofReport } from "../analytics/proofReport.js";

test("larger universe request does not reuse an undersized cached universe", async () => {
  const source = fs.readFileSync(new URL("../server.js", import.meta.url), "utf8");
  const body = source.match(/async function getPreMoverAssetUniverse\([^]*?\n}\r?\n/)[0];
  const calls = [];
  const load = new Function("assetUniverseCache", "getTradableAssets", `${body}; return getPreMoverAssetUniverse;`)(
    { symbols: ["SMALL"], at: Date.now() }, async (limit) => { calls.push(limit); return Array.from({ length: limit }, (_, i) => `S${i}`); });
  assert.equal((await load(5000)).length, 5000);
  assert.deepEqual(calls, [5000]);
  await load(300);
  assert.deepEqual(calls, [5000]);
});

test("latest-session symbols get storage slots and bootstrap preserves existing daily truth", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "sm-audit-store-"));
  try {
    const store = createDiscoveryFeatureStore({ directory });
    const row = (s, d, c = 10) => ({ s, d, o: c, h: c + 1, l: c - 1, c, v: 100 });
    store.writeDaily("2026-09-01", [row("OLD", "2026-09-01")]);
    store.writeDaily("2026-09-02", [row("NEW", "2026-09-02", 20)]);
    const read = await store.readRecentHistories({ maxSymbols: 1 });
    assert.deepEqual([...read.histories.keys()], ["NEW"]);
    store.seedHistories([[row("NEW", "2026-09-01", 19), row("NEW", "2026-09-02", 99)]], "2026-09-03");
    const hydrated = await store.readRecentHistories({ maxSymbols: 2 });
    assert.deepEqual(hydrated.histories.get("NEW").map((r) => r.c), [19, 20]);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("crypto refresh occurs after account/position waits and before any order selection", async () => {
  const sequence = [];
  const strategy = createAutoBuyStrategies({
    getTradingMode: () => "live_crypto", CONFIG: { maxOpenTrades: 8, maxCryptoOpenTrades: 3 },
    getAccount: async () => { sequence.push("account"); return { cash: 1000 }; },
    getPositions: async () => { sequence.push("positions"); return []; },
    getBotOwnedSymbols: async () => { sequence.push("ownership"); return new Set(); },
    getDynamicTradeAmount: () => 100,
    refreshCryptoExecutionQuotes: async () => { sequence.push("refresh"); throw new Error("STOP_BEFORE_ORDER"); },
    executeAdaptiveBuyOrder: () => assert.fail("audit test must never submit"),
  });
  await assert.rejects(strategy.autoBuyCryptoSignals([]), /STOP_BEFORE_ORDER/);
  assert.deepEqual(sequence, ["account", "positions", "ownership", "refresh"]);
});

test("legacy unverified outcomes do not activate learning", () => {
  const state = { updatedAt: "2026-09-07T00:00:00Z", updatedDayKey: "2026-09-07",
    observations: Array.from({ length: 40 }, (_, i) => ({ assetClass: "stock", symbol: `S${i}`,
      targets: { 3: "2026-09-01" }, measurements: { 3: { peakReturnPercent: 20 } } })) };
  assert.equal(calculateQuietCandidateLearning(state, { assetClass: "stock" }).active, false);
  assert.equal(calculateQuietCandidateLearning(state, { assetClass: "stock" }).sampleCount, 0);
  assert.equal(buildProofReport(state).assets.stock.horizons[3].training.sampleCount, 0);
});

test("state compaction retains evidence needed by learning after restart", () => {
  const state = { quietCandidateOutcomeState: { version: 2, observations: [{ id: "one", evidenceVersion: 2,
    baselineEvidenceTimestamp: 1000, measurements: { 1: { evidenceVerified: true } } }] } };
  compactLiveEngineStateHistories(state);
  assert.equal(state.quietCandidateOutcomeState.observations[0].evidenceVersion, 2);
  assert.equal(state.quietCandidateOutcomeState.observations[0].baselineEvidenceTimestamp, 1000);
});

test("daily sampling retains observations long enough to measure day five", () => {
  const start = Date.parse("2026-09-01T12:00:00Z");
  let state = {};
  for (let day = 0; day <= 5; day++) {
    const now = start + day * 86400000;
    const rows = Array.from({ length: 100 }, (_, i) => ({ symbol: `C${i}/USD`, price: 100 + day,
      liveQuoteUpdatedAt: new Date(now).toISOString(), cryptoDiscoveryScore: 80 }));
    state = updateQuietCandidateOutcomes(state, rows, rows, { assetClass: "crypto", now, dayKey: new Date(now).toISOString().slice(0, 10) });
  }
  assert.ok(state.observations.some((o) => o.observedDay === "2026-09-01" && o.measurements[5]?.evidenceVerified));
  assert.ok(state.observationCount <= 300);
});
