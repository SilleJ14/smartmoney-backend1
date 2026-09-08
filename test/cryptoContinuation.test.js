import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateCryptoMultiSessionContinuation,
  hydrateCryptoContinuationMemoryFromDailyBars,
  pruneCryptoContinuationMemory,
  updateCryptoContinuationMemoryEntry,
} from "../scoring/cryptoScoring.js";
import { buildCryptoDecisionScore } from "../scoring/componentScore.js";
import { createCryptoIntelligenceStrategy } from "../strategies/cryptoIntelligenceStrategy.js";

function update(entry, dayKey, price) {
  return updateCryptoContinuationMemoryEntry(
    entry,
    { symbol: "BTC/USD", current: price },
    { now: new Date(`${dayKey}T12:00:00.000Z`) }
  );
}

test("repeated crypto cycles in one UTC day update one continuation session", () => {
  let memory = update({}, "2026-08-18", 100);
  memory = update(memory, "2026-08-18", 102);

  assert.equal(memory.continuationSessions.length, 1);
  assert.equal(memory.continuationSessions[0].close, 102);
  assert.equal(memory.continuationSessions[0].completed, false);
  assert.equal(memory.available, false);
  assert.deepEqual(memory.seenDays, []);
});

test("two completed unique UTC days unlock independent crypto continuation", () => {
  let memory = update({}, "2026-08-18", 100);
  memory = update(memory, "2026-08-19", 102);
  memory = update(memory, "2026-08-20", 104);

  assert.equal(memory.available, true);
  assert.equal(memory.observedSessions, 2);
  assert.deepEqual(memory.seenDays, ["2026-08-18", "2026-08-19"]);

  const decision = buildCryptoDecisionScore({
    symbol: "BTC/USD",
    rawCryptoScore: 72,
    barsFound: 30,
    bid: 103.95,
    ask: 104.05,
    windowDollarVolume: 1_000_000,
    continuationScorecard: memory,
    multiDayAccumulation: { seenDays: memory.seenDays },
  }, { now: Date.parse("2026-08-20T12:00:00Z") });
  assert.equal(decision.componentsByName.runner.available, true);
  assert.equal(decision.componentsByName.runner.source, "continuationScorecard.score");
});

test("duplicate and invalid day labels cannot inflate continuation coverage", () => {
  const decision = buildCryptoDecisionScore({
    symbol: "BTC/USD",
    rawCryptoScore: 72,
    barsFound: 30,
    bid: 99.95,
    ask: 100.05,
    windowDollarVolume: 1_000_000,
    multiDayContinuationScore: 90,
    multiDayAccumulation: {
      seenDays: ["2026-08-18", "2026-08-18", "not-a-day"],
    },
  }, { now: Date.parse("2026-08-20T12:00:00Z") });

  assert.equal(decision.componentsByName.runner.available, false);
  assert.equal(decision.continuationEvidence.seenDays, 1);
});

test("rising completed sessions outrank falling sessions", () => {
  let rising = {};
  let falling = {};
  const days = ["2026-08-17", "2026-08-18", "2026-08-19", "2026-08-20"];
  const risingPrices = [100, 102, 104, 106];
  const fallingPrices = [100, 98, 96, 94];
  days.forEach((dayKey, index) => {
    rising = update(rising, dayKey, risingPrices[index]);
    falling = update(falling, dayKey, fallingPrices[index]);
  });

  assert.equal(rising.available, true);
  assert.equal(falling.available, true);
  assert.ok(rising.score > falling.score);
  assert.ok(rising.score > 60);
  assert.ok(falling.score < 50);
});

test("invalid prices do not create a crypto continuation session", () => {
  const first = update({}, "2026-08-18", 100);
  const invalid = updateCryptoContinuationMemoryEntry(
    first,
    { symbol: "BTC/USD", current: 0 },
    { now: new Date("2026-08-19T12:00:00.000Z") }
  );

  assert.deepEqual(invalid.continuationSessions, first.continuationSessions);
  assert.equal(invalid.lastSeenAt, first.lastSeenAt);
});

test("crypto continuation session and symbol memories stay bounded", () => {
  let memory = {};
  for (let day = 1; day <= 12; day += 1) {
    const dayKey = `2026-08-${String(day).padStart(2, "0")}`;
    memory = update(memory, dayKey, 100 + day);
  }
  assert.equal(memory.continuationSessions.length, 8);

  const symbolMemory = {};
  for (let index = 0; index < 120; index += 1) {
    symbolMemory[`COIN${index}/USD`] = {
      lastSeenAt: new Date(Date.UTC(2026, 7, 20, 0, index)).toISOString(),
      continuationSessions: [],
    };
  }
  const pruned = pruneCryptoContinuationMemory(symbolMemory, {
    now: new Date("2026-08-21T00:00:00.000Z"),
  });
  assert.equal(Object.keys(pruned).length, 100);
});

test("continuation scoring ignores duplicate completed session records", () => {
  const continuation = calculateCryptoMultiSessionContinuation({
    evidenceNow: Date.parse("2026-08-20T12:00:00Z"),
    continuationSessions: [
      { dayKey: "2026-08-18", open: 100, high: 101, low: 99, close: 100, completed: true },
      { dayKey: "2026-08-18", open: 100, high: 102, low: 99, close: 101, completed: true },
      { dayKey: "2026-08-19", open: 101, high: 103, low: 100, close: 102, completed: true },
    ],
  });
  assert.equal(continuation.observedSessions, 2);
  assert.deepEqual(continuation.seenDays, ["2026-08-18", "2026-08-19"]);
});

test("phase51 attachment preserves a legitimate zero continuation score", () => {
  const engineState = {
    multiTimeframeCryptoMemory: {
      "BTC/USD": {
        score: 0,
        available: true,
        coverage: 1,
        tier: "WEAK_MULTI_SESSION_CONTINUATION",
        source: "persisted_crypto_daily_sessions",
        observedSessions: 4,
        seenDays: [
          "2026-08-15",
          "2026-08-16",
          "2026-08-17",
          "2026-08-18",
        ],
      },
    },
  };
  const strategy = createCryptoIntelligenceStrategy({
    calculateCryptoStrategySelection: () => ({}),
    clampScore: (value) => Math.max(0, Math.min(100, Number(value) || 0)),
    engineState,
    normalizeSymbol: (symbol) => String(symbol || "").toUpperCase(),
    saveEngineState() {},
  });
  const [signal] = strategy.applyMultiTimeframeCryptoToSignals([{
    symbol: "BTC/USD",
    score: 50,
    qualifiedToBuy: false,
  }]);

  assert.equal(signal.continuationScorecard.score, 0);
  assert.equal(signal.multiDayContinuationScore, 0);
});

test("completed provider daily bars hydrate multi-day continuation without fabricating sessions", () => {
  const memory = hydrateCryptoContinuationMemoryFromDailyBars(
    {},
    [
      {
        t: "2026-08-29T00:00:00.000Z",
        o: 100,
        h: 103,
        l: 99,
        c: 102,
      },
      {
        t: "2026-08-30T00:00:00.000Z",
        o: 102,
        h: 105,
        l: 101,
        c: 104,
      },
      {
        t: "2026-08-31T00:00:00.000Z",
        o: 104,
        h: 106,
        l: 103,
        c: 105,
      },
      { o: 90, h: 95, l: 89, c: 94 },
      {
        t: "2026-08-28T00:00:00.000Z",
        o: 98,
        h: 0,
        l: 97,
        c: 99,
      },
    ],
    { now: new Date("2026-08-31T14:00:00.000Z") }
  );

  assert.equal(memory.available, true);
  assert.equal(memory.observedSessions, 2);
  assert.equal(memory.historicalDailyBarsHydrated, 2);
  assert.deepEqual(memory.seenDays, ["2026-08-29", "2026-08-30"]);
  assert.deepEqual(
    memory.continuationSessions.map((session) => session.dayKey),
    ["2026-08-29", "2026-08-30"]
  );
  assert.ok(memory.continuationSessions.every((session) => session.completed));
});
