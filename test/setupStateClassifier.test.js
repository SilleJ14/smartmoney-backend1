import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { createDiscoveryFeatureStore } from "../discovery/featureStore.js";
import { calculateQuietPreMoveFeatures, runBoundedQuietDiscovery } from "../discovery/quietDiscoveryPipeline.js";
import { cryptoDiscoveryDailyRows, runBoundedCryptoQuietDiscovery } from "../discovery/cryptoQuietDiscovery.js";
import {
  buildStockDecisionScore,
  calculateEarlyDiscoveryScore,
  calculateEntryQualityScore,
  evaluateStockTradeCandidate,
} from "../scoring/decisionScores.js";
import { calculateCryptoEarlyDiscoveryScore } from "../scoring/earlyDiscovery.js";
import { evaluateCryptoTradeCandidate } from "../scoring/componentScore.js";
import { buildStockOpportunityLayers, finalizeStockOpportunityLayers } from "../scoring/opportunityLayers.js";
import { classifySetupState } from "../scoring/setupStateClassifier.js";

const knownExtension = {
  coverage: 1,
  alreadyExtended: false,
  extensionPenalty: 0,
  horizons: [
    { days: 1, changePercent: 1, extended: false },
    { days: 3, changePercent: 2, extended: false },
    { days: 5, changePercent: 3, extended: false },
    { days: 20, changePercent: 8, extended: false },
  ],
};

function entryReady(extra = {}) {
  return {
    confirmations: { aboveVwap: true, closeNearHighPercent: 85, fakeBreakout: false, newsRiskAvailable: true },
    bid: 10,
    ask: 10.05,
    technicalBarsFound: 30,
    technicals: { ema9: 11, ema20: 10, macd: 2, macdSignal: 1, rsi: 60 },
    phase5SignalQuality: {
      liquidityStabilityScore: 90,
      antiChaseRisk: 10,
      exhaustionRisk: 10,
      spreadWideningRisk: 10,
      breakoutRetestConfirmation: true,
    },
    extensionEvidence: "KNOWN",
    ...extra,
  };
}

function tightBreakoutBars() {
  const bars = Array.from({ length: 24 }, () => ({
    o: 100, h: 100.4, l: 99.7, c: 100.1, v: 1000,
  }));
  bars.push({ o: 100.2, h: 109.5, l: 100, c: 109, v: 2500 });
  return bars;
}

function buyableLayers(signal, score) {
  const layers = buildStockOpportunityLayers({
    ...signal,
    discoveryScore: signal.discoveryScore,
    currentAnalyticalScore: score,
    extensionEvidence: "KNOWN",
  }, { requiredF: 70 });
  return finalizeStockOpportunityLayers(layers, 100, {
    authorizedDecisionValid: true,
    authorizedDecisionScore: score,
    currentAnalyticalScore: score,
  });
}

test("quiet incomplete history keeps structural D and does not invent lateness", () => {
  const discovery = calculateEarlyDiscoveryScore({
    percentChange: 0.2,
    preMoveScore: 95,
    catalystScore: 90,
    compressionScore: 80,
    higherLowCount: 3,
  });
  assert.ok(discovery.score > 72);
  assert.equal(discovery.buyScore, discovery.score);
  assert.notEqual(discovery.score, 55);
  assert.equal(discovery.extensionEvidence, "UNKNOWN");
  assert.ok(["EARLY", "UNKNOWN"].includes(discovery.setupState));
  assert.equal(discovery.tier === "LATE_MOVE_NOT_DISCOVERY", false);
  assert.equal(discovery.gates.includes("LATE_MOVE_NOT_DISCOVERY"), false);
  assert.ok(discovery.gates.includes("INSUFFICIENT_EXTENSION_HISTORY"));
});

test("a first expansion from a tight base is a breakout with canonical D", () => {
  const bars = tightBreakoutBars();
  const discovery = calculateEarlyDiscoveryScore({
    historyDays: 30,
    multiHorizonExtension: knownExtension,
    percentChange: 9,
    preMoveScore: 92,
    relativeVolume: 2.5,
    history: bars,
    compressionScore: 84,
  });
  const entry = calculateEntryQualityScore(entryReady({
    setupState: discovery.setupState,
    discoveryScorecard: discovery,
  }));
  const decision = buildStockDecisionScore({
    discoveryScorecard: discovery,
    entryQualityScorecard: entry,
    contextScore: 80,
    riskPortfolioScore: 80,
    fundamentalBlendScore: 80,
    fundamentalDataValid: true,
  });
  assert.equal(discovery.setupState, "BREAKOUT");
  assert.ok(discovery.score > 72);
  assert.equal(discovery.buyScore, discovery.score);
  assert.equal(discovery.earlyEntryEligible, false);
  assert.ok(entry.score >= 75);
  assert.equal(entry.gates.includes("ENTRY_EXTENDED"), false);
  assert.equal(decision.components.find((item) => item.name === "discovery").value, discovery.score);
  assert.ok(decision.score >= 70);
});

test("a healthy higher structure at plus 12 percent stays continuation", () => {
  const discovery = calculateEarlyDiscoveryScore({
    historyDays: 30,
    multiHorizonExtension: knownExtension,
    percentChange: 12,
    preMoveScore: 90,
    relativeVolume: 1.8,
    continuationStructure: {
      trendIntact: true,
      holdsAboveBreak: true,
      higherStructure: true,
      distanceFromSupportAtr: 1.4,
      twentyDayChange: 12,
    },
  });
  assert.equal(discovery.setupState, "CONTINUATION");
  assert.ok(discovery.score > 72);
  assert.notEqual(discovery.score, 55);
  assert.equal(discovery.buyScore, discovery.score);
});

test("extended stretch preserves D and blocks the entry", () => {
  const discovery = calculateEarlyDiscoveryScore({
    historyDays: 30,
    multiHorizonExtension: knownExtension,
    percentChange: 12,
    preMoveScore: 93,
    relativeVolume: 1.6,
    continuationStructure: {
      trendIntact: true,
      holdsAboveBreak: true,
      higherStructure: true,
      distanceFromSupportAtr: 4.2,
      twentyDayChange: 18,
    },
  });
  const entry = calculateEntryQualityScore(entryReady({
    setupState: discovery.setupState,
    discoveryScorecard: discovery,
  }));
  const decision = buildStockDecisionScore({
    discoveryScorecard: discovery,
    entryQualityScorecard: { score: 80, coverage: 1, approved: true },
    contextScore: 80,
    riskPortfolioScore: 80,
    fundamentalBlendScore: 80,
    fundamentalDataValid: true,
  });
  const gate = evaluateStockTradeCandidate({
    setupState: discovery.setupState,
    discoveryScorecard: discovery,
    stockDecisionScore: decision.score,
    stockDecisionScoreAvailable: true,
    masterFinalScore: decision.score,
    entryQualityScore: entry.score,
    entryQualityScorecard: entry,
  });
  const layers = buyableLayers({
    setupState: discovery.setupState,
    discoveryScore: discovery.score,
    entryQualityScore: entry.score,
  }, Math.max(70, decision.score));
  assert.equal(discovery.setupState, "EXTENDED");
  assert.ok(discovery.score > 72);
  assert.equal(discovery.newLongEntryAllowed, true);
  assert.ok(entry.score <= 55);
  assert.equal(entry.approved, false);
  assert.ok(entry.gates.includes("ENTRY_EXTENDED"));
  assert.equal(gate.approved, false);
  assert.ok(gate.reasons.includes("ENTRY_EXTENDED"));
  assert.equal(layers.buyable, false);
  assert.equal(layers.blockReason, "ENTRY_EXTENDED");
  assert.equal(layers.D, discovery.score);
});

test("climax parabolic exhaustion blocks a new long without erasing D", () => {
  const discovery = calculateEarlyDiscoveryScore({
    historyDays: 30,
    multiHorizonExtension: knownExtension,
    percentChange: 18,
    preMoveScore: 94,
    relativeVolume: 5,
    exhaustionEvidence: { climaxVolume: true, parabolic: true },
  });
  const entry = calculateEntryQualityScore(entryReady({
    setupState: discovery.setupState,
    discoveryScorecard: discovery,
  }));
  const layers = buyableLayers({
    setupState: discovery.setupState,
    discoveryScore: discovery.score,
    entryQualityScore: entry.score,
  }, 84);
  assert.equal(discovery.setupState, "EXHAUSTED");
  assert.equal(discovery.newLongEntryAllowed, false);
  assert.ok(discovery.score > 72);
  assert.ok(entry.score <= 35);
  assert.equal(entry.approved, false);
  assert.ok(entry.gates.includes("EXHAUSTION"));
  assert.equal(layers.buyable, false);
  assert.equal(layers.blockReason, "EXHAUSTION");
  assert.equal(layers.D, discovery.score);
});

test("a loud quiet-scan name leaves the early lane and stays available", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "smartmoney-setup-"));
  try {
    const store = createDiscoveryFeatureStore({ directory, maxHistoryDays: 30, maxDiskBytes: 1024 * 1024 });
    for (let day = 1; day <= 23; day += 1) {
      const date = `2026-07-${String(day).padStart(2, "0")}`;
      store.writeDaily(date, [
        { s: "QUIET", d: date, o: 12, h: 12.08, l: 11.96, c: 12.02, v: 100000 },
        { s: "MOVER", d: date, o: 20, h: 20.08, l: 19.96, c: 20.02, v: 100000 },
      ]);
    }
    const result = await runBoundedQuietDiscovery({
      groupedResults: [
        { T: "QUIET", t: Date.UTC(2026, 6, 24), o: 12, h: 12.08, l: 11.96, c: 12.03, v: 100000 },
        { T: "MOVER", t: Date.UTC(2026, 6, 24), o: 20, h: 22.4, l: 20, c: 22.2, v: 180000 },
      ],
      dateKey: "2026-07-24",
      featureStore: store,
      budgets: { maxUniverse: 10, historyDays: 30, minAverageDollarVolume: 1, watchlistSize: 5, maxCurrentMovePercent: 10 },
      now: () => Date.parse("2026-07-25T23:00:00Z"),
    });
    assert.ok(result.watchlist.some((item) => item.symbol === "QUIET"));
    assert.equal(result.watchlist.some((item) => item.symbol === "MOVER"), false);
    assert.ok(result.setupHandoff.some((item) => item.symbol === "MOVER"));
    assert.ok(result.discoveryCandidates.some((item) => item.symbol === "MOVER"));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("crypto extended names are labeled instead of deleted", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "smartmoney-crypto-setup-"));
  try {
    const store = createDiscoveryFeatureStore({ directory });
    const now = Date.parse("2026-09-18T12:00:00Z");
    const bars = Array.from({ length: 30 }, (_, index) => {
      const base = 100 * (1.035 ** index);
      return {
        t: new Date(now - (30 - index) * 86400000).toISOString(),
        o: base,
        h: base * 1.02,
        l: base * 0.99,
        c: base * 1.015,
        v: 1000,
      };
    });
    const dailyRows = cryptoDiscoveryDailyRows("ETH/USD", bars, { now });
    for (const row of dailyRows) store.writeDaily(row.d, [row]);
    const scored = calculateCryptoEarlyDiscoveryScore({
      symbol: "ETH/USD",
      dailyBars: bars,
      currentPrice: bars.at(-1).c,
      now,
    });
    const result = await runBoundedCryptoQuietDiscovery({
      featureStore: store,
      dailyRows,
      scanCandidates: [],
      now,
    });
    const kept = result.topCandidates.find((item) => item.symbol === "ETH/USD");
    assert.equal(scored.setupState, "EXTENDED");
    assert.ok(kept);
    assert.equal(kept.setupState, "EXTENDED");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("the same bars produce the same setup state in quiet discovery and stock discovery", () => {
  const history = Array.from({ length: 24 }, (_, day) => ({
    s: "AAA",
    d: `2026-07-${String(day + 1).padStart(2, "0")}`,
    o: 10 + day * 0.02,
    h: 10.12 + day * 0.02,
    l: 9.98 + day * 0.02,
    c: 10.08 + day * 0.02,
    v: 100000,
  }));
  const features = calculateQuietPreMoveFeatures(history, { now: Date.parse("2026-07-24T00:00:00Z") });
  const discovery = calculateEarlyDiscoveryScore({
    ...features,
    history,
    percentChange: features.dayChangePercent,
    multiHorizonExtension: features.extension,
  });
  assert.equal(discovery.setupState, features.setupState);
  assert.equal(discovery.extensionEvidence, features.extensionEvidence);
});

test("live scoring and discovery do not keep an independent late-discovery cap", () => {
  const root = path.resolve(".");
  const files = [];
  for (const directory of ["scoring", "discovery", "strategies"]) {
    for (const name of fs.readdirSync(path.join(root, directory))) {
      if (name.endsWith(".js")) files.push(path.join(root, directory, name));
    }
  }
  files.push(path.join(root, "server.js"));
  const forbidden = /lateMoveCap|EXISTING_DISCOVERY_CAP|positiveChange\s*>=\s*10\s*\?\s*55|>=\s*8\s*\?\s*64/;
  const hits = files.filter((file) => forbidden.test(fs.readFileSync(file, "utf8")));
  assert.deepEqual(hits, []);
  assert.equal(fs.readFileSync(path.join(root, "server.js"), "utf8").includes("function calculatePreMoverScore"), false);
});

test("classifier reasons name the evidence instead of the daily percent", () => {
  const result = classifySetupState({
    price: 109,
    percentChange: 9,
    bars: tightBreakoutBars(),
    extension: knownExtension,
    historyDays: 30,
    extensionCoverage: 1,
    relativeVolume: 2.5,
  });
  assert.equal(result.state, "BREAKOUT");
  assert.ok(result.confidence > 0.5);
  assert.ok(result.reasons.includes("BASE_RESISTANCE_CLEARED"));
  assert.ok(result.reasons.includes("VOLUME_EXPANSION"));
  assert.equal(result.extensionEvidence, "KNOWN");
});

test("crypto extended entry is blocked without treating the discovery score as missing", () => {
  const gate = evaluateCryptoTradeCandidate({
    symbol: "ETH/USD",
    setupState: "EXTENDED",
    cryptoDecisionScore: 88,
    cryptoDecisionScoreAvailable: true,
    cryptoDiscoveryScorecard: {
      score: 88,
      coverage: 1,
      setupState: "EXTENDED",
      extension: { alreadyExtended: true, coverage: 1 },
    },
  });
  assert.equal(gate.approved, false);
  assert.ok(gate.reasons.includes("ENTRY_EXTENDED"));
});
