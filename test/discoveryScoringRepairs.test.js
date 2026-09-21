import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { providerDailyBar, providerDailyBarMatchesSession } from "../discovery/providerDailyBar.js";
import { compactGroupedRows } from "../discovery/quietDiscoveryPipeline.js";
import { createDiscoveryFeatureStore } from "../discovery/featureStore.js";
import { shouldReuseQuietDiscoveryState } from "../discovery/quietDiscoverySession.js";
import { isElitePreMoverLabel, isStrongPreMoverLabel, toPreMoverLabel } from "../discovery/preMoverLabels.js";
import { cryptoDiscoveryDailyRows, runBoundedCryptoQuietDiscovery } from "../discovery/cryptoQuietDiscovery.js";
import { calculateCryptoEarlyDiscoveryScore } from "../scoring/earlyDiscovery.js";
import { buildStockDecisionScore, evaluateStockTradeCandidate } from "../scoring/decisionScores.js";
import { evaluateCryptoTradeCandidate } from "../scoring/componentScore.js";
import { missingUsStockMarketSessionDays } from "../utils/usMarketCalendar.js";

test("admin force bypasses a fresh quiet-discovery cache", () => {
  const prior = {
    ok: true,
    dateKey: "2026-09-18",
    updatedAt: "2026-09-18T20:00:00.000Z",
    historicalWarmupRemaining: 0,
  };
  assert.equal(shouldReuseQuietDiscoveryState(prior, { dateKey: "2026-09-18", force: false }), true);
  assert.equal(shouldReuseQuietDiscoveryState(prior, { dateKey: "2026-09-18", force: true }), false);
  assert.equal(shouldReuseQuietDiscoveryState({ ...prior, ok: false }, { dateKey: "2026-09-18" }), false);
});

test("stock daily bars match an ET session even when the UTC date has rolled", () => {
  const afterHours = providerDailyBar("AAPL", {
    t: "2026-08-21T03:00:00.000Z",
    o: 10, h: 11, l: 9, c: 10.5, v: 1000,
  });
  assert.equal(afterHours.etDate, "2026-08-20");
  assert.equal(afterHours.utcDate, "2026-08-21");
  assert.equal(providerDailyBarMatchesSession(afterHours, "2026-08-20"), true);

  const utcMidnight = providerDailyBar("AAPL", {
    t: "2026-08-20T00:00:00.000Z",
    o: 10, h: 11, l: 9, c: 10.5, v: 1000,
  });
  assert.equal(providerDailyBarMatchesSession(utcMidnight, "2026-08-20"), true);
});

test("quiet universe keeps the most liquid names instead of the first provider rows", () => {
  const rows = compactGroupedRows([
    { T: "THIN", d: "2026-08-20", o: 10, h: 11, l: 9, c: 10, v: 10 },
    { T: "LIQUID", d: "2026-08-20", o: 10, h: 11, l: 9, c: 10, v: 100000 },
    { T: "MID", d: "2026-08-20", o: 10, h: 11, l: 9, c: 10, v: 1000 },
  ], "2026-08-20", 2);
  assert.deepEqual(rows.map((row) => row.s), ["LIQUID", "MID"]);
});

test("feature store keeps priority symbols instead of only the newest-file fill", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "sm-priority-store-"));
  try {
    const store = createDiscoveryFeatureStore({ directory });
    const row = (s, d, c = 10) => ({ s, d, o: c, h: c + 1, l: c - 1, c, v: 100 });
    store.writeDaily("2026-09-01", [row("OLD", "2026-09-01")]);
    store.writeDaily("2026-09-02", [row("NEW", "2026-09-02", 20)]);
    const read = await store.readRecentHistories({ maxSymbols: 1, prioritySymbols: ["OLD"] });
    assert.deepEqual([...read.histories.keys()], ["OLD"]);
    store.mergeDaily("2026-09-02", [row("OLD", "2026-09-02", 21)]);
    const merged = await store.readRecentHistories({ maxSymbols: 2 });
    assert.equal(merged.histories.get("OLD").at(-1).c, 21);
    assert.equal(merged.histories.get("NEW").at(-1).c, 20);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("holiday weekends do not wipe stock quiet contiguous history", () => {
  assert.equal(missingUsStockMarketSessionDays("2026-07-02", "2026-07-06"), 0);
  assert.ok(missingUsStockMarketSessionDays("2026-07-02", "2026-07-08") > 1);
});

test("discovery and entry stay unavailable until they have measured evidence", () => {
  const sparse = buildStockDecisionScore({ symbol: "SPARSE", percentChange: 4 });
  assert.equal(sparse.components.find((item) => item.name === "discovery").available, false);
  assert.equal(sparse.components.find((item) => item.name === "entry").available, false);
  assert.equal(sparse.coverage, 0);
  const complete = buildStockDecisionScore({
    symbol: "BASE",
    historyDays: 30,
    multiHorizonExtension: { coverage: 1, alreadyExtended: false, extensionPenalty: 0 },
    preMoveScore: 88,
    percentChange: 2,
    catalystScore: 80,
    technicalBarsFound: 30,
    technicals: { ema9: 102, ema20: 100, macd: 2, macdSignal: 1, rsi: 60 },
    confirmations: { closeNearHighPercent: 95, aboveVwap: true, fakeBreakout: false, newsRisk: false, newsRiskAvailable: true },
    phase5SignalQuality: { liquidityStabilityScore: 90, breakoutRetestConfirmation: true, antiChaseRisk: 10 },
    spreadAvailable: true, bid: 99.9, ask: 100.1,
    contextScore: 80, riskPortfolioScore: 85, fundamentalScore: 75, fundamentalDataValid: true,
  });
  assert.equal(complete.components.find((item) => item.name === "discovery").available, true);
  assert.equal(complete.components.find((item) => item.name === "entry").available, true);
});

test("crypto early discovery reports empty-history reasons without fabricating bars", () => {
  const now = Date.parse("2026-09-18T12:00:00Z");
  const closeOnly = calculateCryptoEarlyDiscoveryScore({
    dailyBars: Array.from({ length: 30 }, (_, index) => ({ c: 100 + index, v: 10 })),
    currentPrice: 130,
    now,
  });
  assert.equal(closeOnly.dataQuality.completedValidDailyBars, 0);
  assert.ok(closeOnly.dataQuality.historyNormalization.includes("NO_VALID_OHLC_BARS"));
  assert.ok(closeOnly.gates.includes("NO_VALID_OHLC_BARS"));
  assert.equal(closeOnly.score, 0);
});

test("a single missing crypto daily bar does not wipe a complete quiet history", () => {
  const now = Date.parse("2026-09-18T12:00:00Z");
  const bars = [];
  let offset = 32;
  for (let index = 0; index < 30; index += 1) {
    if (index === 2) offset -= 1;
    const base = 100 + index * 0.08;
    bars.push({
      t: new Date(now - offset * 86400000).toISOString(),
      o: base, h: base + 0.4, l: base - 0.2, c: base + 0.1, v: 800,
    });
    offset -= 1;
  }
  const result = calculateCryptoEarlyDiscoveryScore({
    symbol: "BTC/USD",
    dailyBars: bars,
    currentPrice: bars.at(-1).c,
    now,
  });
  assert.ok(result.dataQuality.completedValidDailyBars >= 21);
  assert.ok(!result.dataQuality.historyNormalization.includes("LATEST_COMPLETED_BAR_STALE"));
});

test("crypto evaluate honors require flags without loosening the default path", () => {
  const now = Date.now();
  const loose = evaluateCryptoTradeCandidate({
    symbol: "BTC/USD",
    cryptoDecisionScore: 90,
    cryptoDecisionScoreAvailable: true,
  }, { now, requireCentralDecision: false, requireFreshDecision: false, requireExplicitApproval: false });
  assert.equal(loose.reasons.includes("NOT_QUALIFIED_TO_BUY"), false);
  assert.equal(loose.reasons.includes("CENTRAL_DECISION_NOT_APPROVED"), false);
  const strict = evaluateCryptoTradeCandidate({
    symbol: "BTC/USD",
    cryptoDecisionScore: 90,
    cryptoDecisionScoreAvailable: true,
  }, { now });
  assert.equal(strict.approved, false);
  assert.ok(strict.reasons.includes("CRYPTO_QUOTE_OR_SPREAD_NOT_FRESH"));
});

test("elite discovery labels still receive the pre-mover scan boost mapping", () => {
  assert.equal(toPreMoverLabel("ELITE_DISCOVERY", 88), "ELITE_PRE_MOVER");
  assert.equal(isElitePreMoverLabel("ELITE_DISCOVERY"), true);
  assert.equal(isStrongPreMoverLabel("STRONG_DISCOVERY"), true);
  assert.equal(isElitePreMoverLabel("STRONG_DISCOVERY"), false);
});

test("crypto quiet discovery persists daily bars into a bounded store", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "sm-crypto-quiet-"));
  try {
    const store = createDiscoveryFeatureStore({ directory });
    const now = Date.parse("2026-09-18T12:00:00Z");
    const bars = Array.from({ length: 30 }, (_, index) => ({
      t: new Date(now - (30 - index) * 86400000).toISOString(),
      o: 100, h: 100.4, l: 99.8, c: 100.1, v: 1000,
    }));
    const dailyRows = cryptoDiscoveryDailyRows("BTC/USD", bars, { now });
    const result = await runBoundedCryptoQuietDiscovery({
      featureStore: store,
      dailyRows,
      scanCandidates: [],
      reviewedCount: 1,
      now,
    });
    assert.equal(result.phase, "BOUNDED_CRYPTO_QUIET_DISCOVERY");
    assert.ok(store.stats().fileCount > 0);
    assert.equal(typeof result.ok, "boolean");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("stock evaluate still uses the existing require defaults", () => {
  const gate = evaluateStockTradeCandidate({ symbol: "AAPL" });
  assert.equal(gate.approved, false);
});
