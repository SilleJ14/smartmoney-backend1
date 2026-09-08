import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateCryptoEarlyDiscoveryScore,
  calculateMultiHorizonExtension,
  normalizeDiscoveryBars,
} from "../scoring/earlyDiscovery.js";

function quietDailyBars() {
  return Array.from({ length: 30 }, (_, index) => {
    const base = 100 + index * 0.08;
    const range = index < 25 ? 1.2 : 0.35;
    return {
      o: base,
      h: base + range * 0.65,
      l: base - range * 0.35,
      c: base + 0.12,
      v: index < 25 ? 1_000 : 650,
    };
  });
}

function intradayAwakeningBars() {
  return Array.from({ length: 12 }, (_, index) => ({
    o: 102.4 + index * 0.01,
    h: 102.45 + index * 0.01,
    l: 102.35 + index * 0.01,
    c: 102.42 + index * 0.01,
    v: index === 11 ? 1_700 : 1_000,
  }));
}

test("crypto early discovery rewards quiet compression before momentum", () => {
  const dailyBars = quietDailyBars();
  const result = calculateCryptoEarlyDiscoveryScore({
    symbol: "BTC/USD",
    dailyBars,
    intradayBars: intradayAwakeningBars(),
    currentPrice: dailyBars.at(-1).c,
  });

  assert.ok(result.score >= 70);
  assert.equal(result.extension.alreadyExtended, false);
  assert.ok(result.features.compressionScore >= 75);
  assert.ok(result.features.volumeDryUpScore >= 75);
  assert.ok(result.features.earlyVolumeAwakeningScore >= 75);
  assert.deepEqual(
    result.components.map((component) => component.name),
    ["structure", "accumulation", "volumeLifecycle", "catalystNovelty"]
  );
});

test("missing news lowers coverage without suppressing technical discovery", () => {
  const dailyBars = quietDailyBars();
  const technicalOnly = calculateCryptoEarlyDiscoveryScore({
    symbol: "BTC/USD",
    dailyBars,
    intradayBars: intradayAwakeningBars(),
    currentPrice: dailyBars.at(-1).c,
  });
  const withCatalyst = calculateCryptoEarlyDiscoveryScore({
    symbol: "BTC/USD",
    dailyBars,
    intradayBars: intradayAwakeningBars(),
    currentPrice: dailyBars.at(-1).c,
    newsCatalyst: {
      catalystAvailable: true,
      catalystScore: 75,
      riskDetected: false,
      source: "test_news",
    },
  });

  assert.equal(technicalOnly.score, technicalOnly.technicalScore);
  assert.equal(technicalOnly.coverage, 0.85);
  assert.ok(withCatalyst.score > technicalOnly.score);
  assert.ok(withCatalyst.catalystBonus > 0);
});

test("multi-horizon extension demotes an asset that already ran", () => {
  const dailyBars = Array.from({ length: 30 }, (_, index) => {
    const base = 100 * (1.035 ** index);
    return { o: base, h: base * 1.02, l: base * 0.99, c: base * 1.015, v: 1_000 };
  });
  const result = calculateCryptoEarlyDiscoveryScore({
    symbol: "ETH/USD",
    dailyBars,
    intradayBars: intradayAwakeningBars(),
    currentPrice: dailyBars.at(-1).c,
  });

  assert.equal(result.extension.alreadyExtended, true);
  assert.ok(result.score <= 55);
  assert.equal(result.tier, "LATE_CRYPTO_MOVE");
  assert.ok(result.gates.includes("ALREADY_EXTENDED_MULTI_HORIZON"));
  assert.ok(result.extension.extensionPenalty <= 45);
  assert.equal(result.extension.penaltyMethod, "MAX_CORRELATED_HORIZON_ONLY");
});

test("extension exposes 1, 3, 5 and 20 day evidence", () => {
  const bars = Array.from({ length: 25 }, (_, index) => ({
    o: 100 + index,
    h: 101 + index,
    l: 99 + index,
    c: 100 + index,
    v: 1_000,
  }));
  const result = calculateMultiHorizonExtension({
    bars,
    currentPrice: bars.at(-1).c,
    assetClass: "stock",
  });

  assert.deepEqual(result.horizons.map((item) => item.days), [1, 3, 5, 20]);
  assert.equal(result.availableHorizons, 4);
});

test("bar normalization sorts timestamps, removes duplicates, and rejects fabricated OHLC", () => {
  const bars = [
    { t: "2026-08-20T00:00:00Z", o: 100, h: 102, l: 99, c: 101, v: 10 },
    { t: "2026-08-18T00:00:00Z", o: 98, h: 100, l: 97, c: 99, v: 10 },
    { t: "2026-08-20T00:00:00Z", o: 101, h: 103, l: 100, c: 102, v: 12 },
    { t: "2026-08-19T00:00:00Z", o: 99, h: 101, l: 98, c: 100, v: 10 },
    { t: "2026-08-21T00:00:00Z", c: 103, v: 10 },
  ];
  const normalized = normalizeDiscoveryBars(bars);

  assert.deepEqual(normalized.map((bar) => bar.close), [99, 100, 102]);
  assert.equal(normalized.at(-1).volume, 12);
});

test("close-only candles cannot become an elite crypto discovery", () => {
  const dailyBars = Array.from({ length: 30 }, (_, index) => ({
    c: 100 + index * 0.1,
    v: 1_000,
  }));
  const result = calculateCryptoEarlyDiscoveryScore({
    symbol: "BTC/USD",
    dailyBars,
    intradayBars: dailyBars.slice(-12),
    currentPrice: dailyBars.at(-1).c,
  });

  assert.equal(result.dataQuality.completedValidDailyBars, 0);
  assert.notEqual(result.tier, "ELITE_CRYPTO_PRE_MOVER");
  assert.ok(result.gates.includes("INSUFFICIENT_COMPLETED_DAILY_HISTORY"));
});

test("the unfinished current daily candle is excluded from extension evidence", () => {
  const now = Date.parse("2026-08-26T12:00:00Z");
  const dailyBars = Array.from({ length: 22 }, (_, index) => {
    const time = new Date(Date.parse("2026-08-05T00:00:00Z") + index * 86_400_000);
    const close = index === 21 ? 180 : 100 + index * 0.1;
    return { t: time.toISOString(), o: close, h: close + 1, l: close - 1, c: close, v: 1_000 };
  });
  const result = calculateCryptoEarlyDiscoveryScore({
    symbol: "ETH/USD",
    dailyBars,
    intradayBars: intradayAwakeningBars(),
    currentPrice: dailyBars[20].c,
    now,
  });

  assert.equal(result.dataQuality.completedValidDailyBars, 21);
  assert.equal(result.extension.coverage, 1);
  assert.equal(result.extension.changes.day1 < 1, true);
});
