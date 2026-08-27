import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateStockOutcomeLearning,
  getDueStockOutcomeSymbols,
  updateStockScoreOutcomes,
} from "../scoring/stockScoreOutcomeTracker.js";

const mondayMorning = Date.parse("2026-08-24T14:00:00.000Z");

function stock(symbol, price, score = 75) {
  return {
    symbol,
    current: price,
    stockDecisionScore: score,
    discoveryScore: 70,
    entryQualityScore: 80,
    multiDayContinuationScore: 65,
    watchlistEligible: score >= 60,
    qualifiedCandidate: score >= 72,
  };
}

test("score outcomes record one observation per stock per ET day and measure due horizons", () => {
  const started = updateStockScoreOutcomes({}, [stock("TEST", 100)], {
    now: mondayMorning,
  });
  const oneHour = updateStockScoreOutcomes(started, [stock("TEST", 102)], {
    now: mondayMorning + 60 * 60 * 1000,
  });
  const completed = updateStockScoreOutcomes(oneHour, [stock("TEST", 110)], {
    now: Date.parse("2026-08-31T21:00:00.000Z"),
  });

  assert.equal(oneHour.observationCount, 1);
  assert.equal(oneHour.observations[0].measurements.oneHour.returnPercent, 2);
  assert.equal(completed.observationCount, 2);
  const original = completed.observations.find((item) => item.id === "TEST:2026-08-24");
  assert.ok(original.measurements.close);
  assert.ok(original.measurements.oneDay);
  assert.ok(original.measurements.threeDay);
  assert.ok(original.measurements.fiveDay);
  assert.equal(completed.summary.QUALIFIED.oneHour.count, 1);
});

test("score outcome state is strictly bounded", () => {
  const state = updateStockScoreOutcomes(
    {},
    [stock("AAA", 10), stock("BBB", 20), stock("CCC", 30)],
    { now: mondayMorning, maxObservations: 2, maxNewPerCycle: 3 }
  );

  assert.equal(state.observationCount, 2);
  assert.equal(state.maxObservations, 2);
});

test("vanished candidates receive bounded independent follow-up measurements", () => {
  const started = updateStockScoreOutcomes({}, [stock("VANISH", 100, 80)], {
    now: mondayMorning,
  });
  const dueAt = mondayMorning + 2 * 60 * 60 * 1000;
  assert.deepEqual(
    getDueStockOutcomeSymbols(started, [], { now: dueAt }),
    ["VANISH"]
  );
  assert.deepEqual(
    getDueStockOutcomeSymbols(started, [], {
      now: dueAt,
      lastAttemptBySymbol: { VANISH: dueAt - 60_000 },
    }),
    []
  );

  const measured = updateStockScoreOutcomes(started, [{
    symbol: "VANISH",
    current: 95,
    outcomeFollowupOnly: true,
    liveQuoteSource: "alpaca_outcome_followup",
    liveQuoteUpdatedAt: new Date(dueAt).toISOString(),
  }, {
    symbol: "ORPHAN",
    current: 20,
    outcomeFollowupOnly: true,
  }], { now: dueAt });

  assert.equal(measured.observationCount, 1);
  assert.equal(measured.observations[0].measurements.oneHour.returnPercent, -5);
  assert.equal(
    measured.observations[0].measurements.oneHour.quoteSource,
    "alpaca_outcome_followup"
  );
});

test("stale or future Alpaca follow-up quotes cannot become outcome evidence", () => {
  const started = updateStockScoreOutcomes({}, [stock("TIMED", 100, 80)], {
    now: mondayMorning,
  });
  const dueAt = mondayMorning + 2 * 60 * 60 * 1000;
  const stale = updateStockScoreOutcomes(started, [{
    symbol: "TIMED",
    current: 110,
    outcomeFollowupOnly: true,
    liveQuoteSource: "alpaca_outcome_followup",
    liveQuoteUpdatedAt: new Date(dueAt - 31 * 60 * 1000).toISOString(),
  }], { now: dueAt });
  assert.equal(stale.observations[0].measurements.oneHour, undefined);

  const future = updateStockScoreOutcomes(started, [{
    symbol: "TIMED",
    current: 110,
    outcomeFollowupOnly: true,
    liveQuoteSource: "alpaca_outcome_followup",
    liveQuoteUpdatedAt: new Date(dueAt + 60 * 1000).toISOString(),
  }], { now: dueAt });
  assert.equal(future.observations[0].measurements.oneHour, undefined);

  const fresh = updateStockScoreOutcomes(started, [{
    symbol: "TIMED",
    current: 105,
    outcomeFollowupOnly: true,
    liveQuoteSource: "alpaca_outcome_followup",
    liveQuoteUpdatedAt: new Date(dueAt).toISOString(),
  }], { now: dueAt });
  assert.equal(fresh.observations[0].measurements.oneHour.returnPercent, 5);
  assert.equal(fresh.observations[0].measurements.oneHour.measuredAt, dueAt);
});

function learningState(sampleCount, measuredCount = sampleCount) {
  const now = Date.parse("2026-09-30T21:00:00.000Z");
  return {
    updatedAt: new Date(now).toISOString(),
    observations: Array.from({ length: sampleCount }, (_, index) => ({
      symbol: `T${index}`,
      baselinePrice: 10,
      targets: { oneDay: now - 60_000 },
      componentScores: {
        discovery: 40 + index,
        entry: 80 - index,
        marketContext: 60,
        riskPortfolio: 60,
        fundamentals: null,
      },
      measurements: index < measuredCount
        ? {
          oneDay: {
            returnPercent: index - sampleCount / 2,
            delayMinutes: 10,
          },
        }
        : {},
    })),
  };
}

test("outcome learning waits for 30 well-measured samples and stays bounded", () => {
  const tooFew = calculateStockOutcomeLearning(learningState(29));
  assert.equal(tooFew.active, false);
  assert.equal(tooFew.reason, "WAITING_FOR_MINIMUM_OUTCOME_SAMPLES");

  const incomplete = calculateStockOutcomeLearning(learningState(40, 30));
  assert.equal(incomplete.active, false);
  assert.equal(incomplete.reason, "OUTCOME_MEASUREMENT_COVERAGE_TOO_LOW");

  const lowDiversityState = learningState(30);
  lowDiversityState.observations = lowDiversityState.observations.map(
    (observation) => ({ ...observation, symbol: "ONLYONE" })
  );
  const lowDiversity = calculateStockOutcomeLearning(lowDiversityState);
  assert.equal(lowDiversity.active, false);
  assert.equal(lowDiversity.reason, "OUTCOME_SYMBOL_DIVERSITY_TOO_LOW");

  const active = calculateStockOutcomeLearning(learningState(30));
  assert.equal(active.active, true);
  assert.equal(active.measurementCoverage, 1);
  assert.equal(active.componentMultipliers.discovery, 1.05);
  assert.equal(active.componentMultipliers.entry, 0.95);
  assert.equal(active.componentMultipliers.fundamentals, 1);
  assert.ok(
    Object.values(active.componentMultipliers).every(
      (value) => value >= 0.95 && value <= 1.05
    )
  );
});

test("unavailable decision components remain excluded from outcome learning", () => {
  const state = updateStockScoreOutcomes({}, [{
    symbol: "NOFUND",
    current: 10,
    stockDecisionScore: 70,
    fundamentalScore: 95,
    decisionScoreTelemetry: {
      stages: {
        decision: {
          components: [
            { name: "fundamentals", value: 95, available: false },
          ],
        },
      },
    },
  }], { now: mondayMorning });

  assert.equal(state.observations[0].componentScores.fundamentals, null);
});
