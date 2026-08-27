import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { createDiscoveryFeatureStore } from "../discovery/featureStore.js";
import {
  calculateQuietPreMoveFeatures,
  compactGroupedRows,
  runBoundedQuietDiscovery,
} from "../discovery/quietDiscoveryPipeline.js";

function rowsForDay(day, symbols = ["QUIET", "LOUD"]) {
  return symbols.map((symbol, index) => {
    const base = 10 + day * 0.03 + index;
    return { T: symbol, o: base, h: base * 1.01, l: base * 0.995, c: base * 1.005, v: 100000 + day * 3000 };
  });
}

test("quiet features reward compression and accumulation without a current price spike", () => {
  const history = Array.from({ length: 20 }, (_, day) => ({ s: "AAA", d: `2026-07-${String(day + 1).padStart(2, "0")}`, o: 10 + day * 0.02, h: 10.12 + day * 0.02, l: 9.98 + day * 0.02, c: 10.08 + day * 0.02, v: 100000 + day * 5000 }));
  const features = calculateQuietPreMoveFeatures(history);
  assert.ok(features.preMoveScore > 50);
  assert.ok(Math.abs(features.dayChangePercent) < 3);
});

test("stock quiet discovery cannot qualify strongly without complete 20-day extension evidence", () => {
  const history = Array.from({ length: 20 }, (_, day) => ({
    s: "AAA",
    d: `2026-07-${String(day + 1).padStart(2, "0")}`,
    o: 10 + day * 0.02,
    h: 10.12 + day * 0.02,
    l: 9.98 + day * 0.02,
    c: 10.08 + day * 0.02,
    v: 100000 + day * 5000,
  }));
  const features = calculateQuietPreMoveFeatures(history);

  assert.equal(features.discoveryScorecard.dataQuality.fullExtensionCoverage, false);
  assert.ok(features.discoveryScorecard.gates.includes(
    "INCOMPLETE_MULTI_HORIZON_EXTENSION_EVIDENCE"
  ));
  assert.equal(features.discoveryTier, "INSUFFICIENT_EXTENSION_EVIDENCE");
  assert.ok(features.preMoveScore <= 55);
});

test("quiet discovery sorts, deduplicates, and rejects malformed daily candles", () => {
  const validRows = Array.from({ length: 21 }, (_, day) => ({
    s: "SAFE",
    d: `2026-07-${String(day + 1).padStart(2, "0")}`,
    o: 10,
    h: 10.2,
    l: 9.9,
    c: 10.1,
    v: 100000,
  }));
  const history = [
    ...validRows.slice().reverse(),
    { ...validRows[5], c: 10.05 },
    { s: "SAFE", d: "2026-07-22", o: 10, h: 9, l: 8, c: 10, v: 100000 },
  ];
  const features = calculateQuietPreMoveFeatures(history);

  assert.equal(features.historyDays, 21);
  assert.equal(features.discoveryScorecard.dataQuality.fullExtensionCoverage, true);

  const compact = compactGroupedRows([
    { T: "SAFE", o: 10, h: 10.2, l: 9.9, c: 10.1, v: 100 },
    { T: "SAFE", o: 10, h: 10.3, l: 9.8, c: 10.2, v: 120 },
    { T: "BAD", o: 10, h: 9, l: 8, c: 10, v: 100 },
  ], "2026-08-27");
  assert.equal(compact.length, 1);
  assert.equal(compact[0].c, 10.2);
});

test("disk store prunes history and pipeline excludes already-loud movers", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "smartmoney-discovery-"));
  try {
    const store = createDiscoveryFeatureStore({ directory, maxHistoryDays: 12, maxDiskBytes: 1024 * 1024 });
    for (let day = 0; day < 20; day += 1) {
      const date = `2026-07-${String(day + 1).padStart(2, "0")}`;
      store.writeDaily(date, rowsForDay(day).map((item) => ({ s: item.T, d: date, o: item.o, h: item.h, l: item.l, c: item.c, v: item.v })));
    }
    assert.equal(store.stats().fileCount, 12);
    const currentRows = rowsForDay(20);
    currentRows.find((item) => item.T === "LOUD").c *= 1.12;
    const result = await runBoundedQuietDiscovery({ groupedResults: currentRows, dateKey: "2026-08-01", featureStore: store, budgets: { maxUniverse: 10, historyDays: 20, minAverageDollarVolume: 1, watchlistSize: 5 } });
    assert.ok(result.watchlist.some((item) => item.symbol === "QUIET"));
    assert.ok(!result.watchlist.some((item) => item.symbol === "LOUD"));
    assert.ok(result.resourceUsage.store.bytes <= 1024 * 1024);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
