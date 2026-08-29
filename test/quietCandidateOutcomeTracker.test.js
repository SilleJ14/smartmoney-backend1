import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateQuietCandidateLearning,
  summarizeQuietCandidateOutcomes,
  updateQuietCandidateOutcomes,
} from "../scoring/quietCandidateOutcomeTracker.js";

function candidates(count, price = 100) {
  return Array.from({ length: count }, (_, index) => ({
    symbol: `Q${String(index).padStart(2, "0")}`,
    current: price,
    high: price,
    cryptoDiscoveryScore: 60 + (index % 30),
    cryptoDiscoveryTier: "DEVELOPING_CRYPTO_PRE_MOVER",
    cryptoDiscoveryScorecard: {
      score: 60 + (index % 30),
      components: [
        { name: "structure", value: 50 + index, available: true },
        { name: "accumulation", value: 80 - index / 2, available: true },
      ],
    },
  }));
}

test("every selected quiet candidate is tracked even when it never becomes a trade", () => {
  const selected = candidates(3);
  const state = updateQuietCandidateOutcomes({}, selected, selected, {
    assetClass: "crypto",
    dayKey: "2026-08-20",
    now: Date.parse("2026-08-20T00:00:00Z"),
  });

  assert.equal(state.observationCount, 3);
  assert.ok(state.observations.every((item) => item.selectedQuietCandidate));
  assert.ok(state.observations.every((item) => item.becameTrade === false));
  assert.deepEqual(Object.keys(state.observations[0].targets), ["1", "3", "5"]);
});

test("null persisted outcome state is migrated without stopping the engine", () => {
  const state = updateQuietCandidateOutcomes(
    null,
    [{ symbol: "AAPL", price: 100, discoveryScore: 80 }],
    [{ symbol: "AAPL", price: 100 }],
    {
      assetClass: "stock",
      dayKey: "2026-08-26",
      now: Date.parse("2026-08-26T14:00:00.000Z"),
    }
  );

  assert.equal(state.observationCount, 1);
  assert.equal(state.observations[0].symbol, "AAPL");
  assert.equal(state.learning.stock.active, false);
  assert.equal(state.learning.crypto.active, false);
});

test("quiet candidates receive 1, 3 and 5 day measurements", () => {
  const selected = candidates(2);
  let state = updateQuietCandidateOutcomes({}, selected, selected, {
    assetClass: "crypto",
    dayKey: "2026-08-20",
    now: Date.parse("2026-08-20T00:00:00Z"),
  });
  for (const [dayKey, price] of [
    ["2026-08-21", 104],
    ["2026-08-23", 111],
    ["2026-08-25", 108],
  ]) {
    state = updateQuietCandidateOutcomes(
      state,
      [],
      candidates(2, price),
      {
        assetClass: "crypto",
        dayKey,
        now: Date.parse(`${dayKey}T00:00:00Z`),
      }
    );
  }

  assert.deepEqual(Object.keys(state.observations[0].measurements), ["1", "3", "5"]);
  assert.equal(state.observations[0].measurements[3].breakoutHit, true);
});

test("late outcome quotes are marked missed instead of mislabeled as the target horizon", () => {
  let state = updateQuietCandidateOutcomes({}, candidates(1), candidates(1), {
    assetClass: "crypto",
    dayKey: "2026-08-20",
    now: Date.parse("2026-08-20T00:00:00Z"),
  });
  state = updateQuietCandidateOutcomes(state, [], candidates(1, 110), {
    assetClass: "crypto",
    dayKey: "2026-08-22",
    now: Date.parse("2026-08-22T00:00:00Z"),
  });
  assert.equal(state.observations[0].measurements[1].status, "MISSED_TARGET_WINDOW");
  assert.equal(state.observations[0].measurements[1].closeReturnPercent, null);
  assert.equal(state.learning.crypto.sampleCount, 0);
});

test("outcome tracking excludes the discovery bar high from future peak returns", () => {
  let state = updateQuietCandidateOutcomes(
    {},
    [{
      symbol: "NOLEAK",
      current: 100,
      high: 115,
      cryptoDiscoveryScore: 80,
    }],
    [],
    {
      assetClass: "crypto",
      dayKey: "2026-08-20",
      now: Date.parse("2026-08-20T00:00:00Z"),
    }
  );
  state = updateQuietCandidateOutcomes(
    state,
    [],
    [{ symbol: "NOLEAK", current: 100, high: 100 }],
    {
      assetClass: "crypto",
      dayKey: "2026-08-21",
      now: Date.parse("2026-08-21T00:00:00Z"),
    }
  );

  assert.equal(state.observations[0].measurements[1].peakReturnPercent, 0);
  assert.equal(state.observations[0].measurements[1].breakoutHit, false);
});

test("rolling 24-hour crypto highs cannot leak into post-selection peak outcomes", () => {
  let state = updateQuietCandidateOutcomes(
    {},
    [{ symbol: "NO24H", current: 100, high: 100, cryptoDiscoveryScore: 80 }],
    [],
    {
      assetClass: "crypto",
      dayKey: "2026-08-20",
      now: Date.parse("2026-08-20T00:00:00Z"),
    }
  );
  state = updateQuietCandidateOutcomes(
    state,
    [],
    [{ symbol: "NO24H", current: 101, high: 130 }],
    {
      assetClass: "crypto",
      dayKey: "2026-08-21",
      now: Date.parse("2026-08-21T00:00:00Z"),
    }
  );

  assert.equal(state.observations[0].measurements[1].peakReturnPercent, 1);
  assert.equal(state.observations[0].measurements[1].breakoutHit, false);
});

test("quiet outcomes distinguish candidates that later became trades", () => {
  let state = updateQuietCandidateOutcomes(
    {},
    candidates(1),
    candidates(1),
    {
      assetClass: "crypto",
      dayKey: "2026-08-20",
      now: Date.parse("2026-08-20T00:00:00Z"),
    }
  );
  state = updateQuietCandidateOutcomes(
    state,
    [],
    candidates(1),
    {
      assetClass: "crypto",
      dayKey: "2026-08-21",
      tradedSymbols: ["Q00"],
      now: Date.parse("2026-08-21T00:00:00Z"),
    }
  );

  assert.equal(state.observations[0].becameTrade, true);
  assert.equal(
    state.observations[0].becameTradeAt,
    Date.parse("2026-08-21T00:00:00Z")
  );
});

test("learning remains inactive until 30 measured and diverse examples exist", () => {
  const selected = candidates(30);
  let state = updateQuietCandidateOutcomes({}, selected, selected, {
    assetClass: "crypto",
    dayKey: "2026-08-20",
    now: Date.parse("2026-08-20T00:00:00Z"),
  });
  const early = calculateQuietCandidateLearning(state, { assetClass: "crypto" });
  assert.equal(early.active, false);

  state = updateQuietCandidateOutcomes(
    state,
    [],
    selected.map((candidate, index) => ({
      ...candidate,
      current: 100 + index * 0.5,
      high: 102 + index,
    })),
    {
      assetClass: "crypto",
      dayKey: "2026-08-23",
      now: Date.parse("2026-08-23T00:00:00Z"),
    }
  );
  const learned = calculateQuietCandidateLearning(state, { assetClass: "crypto" });

  assert.equal(learned.active, true);
  assert.equal(learned.sampleCount, 30);
  assert.equal(learned.uniqueSymbolCount, 30);
  assert.ok(Object.values(learned.componentMultipliers).every(
    (multiplier) => multiplier >= 0.9 && multiplier <= 1.1
  ));
});

test("quiet-candidate runtime memory keeps each asset capped at 300 observations", () => {
  const selected = candidates(700);
  const state = updateQuietCandidateOutcomes({}, selected, selected, {
    assetClass: "crypto",
    dayKey: "2026-08-20",
    maxObservations: 10_000,
  });

  assert.equal(state.maxObservations, 600);
  assert.equal(state.observationCount, 300);
  assert.equal(state.maxObservationsPerAsset, 300);
});

test("a position already open at discovery is not credited as a discovered trade", () => {
  const selected = candidates(1);
  let state = updateQuietCandidateOutcomes({}, selected, selected, {
    assetClass: "crypto",
    dayKey: "2026-08-20",
    now: Date.parse("2026-08-20T12:00:00Z"),
    tradedSymbols: ["Q00"],
  });
  state = updateQuietCandidateOutcomes(state, [], selected, {
    assetClass: "crypto",
    dayKey: "2026-08-22",
    now: Date.parse("2026-08-22T12:00:00Z"),
    tradedSymbols: ["Q00"],
  });

  assert.equal(state.observations[0].alreadyTradedAtSelection, true);
  assert.equal(state.observations[0].becameTrade, false);
});

test("crypto one-day outcomes require a full 24 hours rather than a date rollover", () => {
  const selected = candidates(1);
  let state = updateQuietCandidateOutcomes({}, selected, selected, {
    assetClass: "crypto",
    dayKey: "2026-08-20",
    now: Date.parse("2026-08-20T23:59:00Z"),
  });
  state = updateQuietCandidateOutcomes(state, [], candidates(1, 105), {
    assetClass: "crypto",
    dayKey: "2026-08-21",
    now: Date.parse("2026-08-21T00:01:00Z"),
  });
  assert.equal(state.observations[0].measurements[1], undefined);

  state = updateQuietCandidateOutcomes(state, [], candidates(1, 106), {
    assetClass: "crypto",
    dayKey: "2026-08-21",
    now: Date.parse("2026-08-21T23:59:00Z"),
  });
  assert.ok(state.observations[0].measurements[1]);
});

test("quiet discovery proof summarizes every measured candidate without exposing symbols", () => {
  const outcomeState = {
    updatedAt: "2026-08-26T20:15:00.000Z",
    observations: [
      {
        assetClass: "stock",
        symbol: "AAA",
        becameTrade: true,
        measurements: {
          1: { closeReturnPercent: 4, peakReturnPercent: 9, breakoutHit: true },
          3: { closeReturnPercent: 6, peakReturnPercent: 12, breakoutHit: true },
        },
      },
      {
        assetClass: "stock",
        symbol: "BBB",
        becameTrade: false,
        measurements: {
          1: { closeReturnPercent: -2, peakReturnPercent: 3, breakoutHit: false },
        },
      },
      {
        assetClass: "crypto",
        symbol: "CCC/USD",
        becameTrade: false,
        measurements: {
          1: { closeReturnPercent: 7, peakReturnPercent: 11, breakoutHit: true },
        },
      },
    ],
    learning: {
      stock: { assetClass: "stock", sampleCount: 2, minimumSamples: 30 },
      crypto: { assetClass: "crypto", sampleCount: 1, minimumSamples: 30 },
    },
  };
  const proof = summarizeQuietCandidateOutcomes(outcomeState, {
    stockDiscoveryState: {
      updatedAt: "2026-08-26T20:10:00.000Z",
      provider: "alpaca_multi_symbol_daily_fallback",
      universeRows: 5000,
      watchlistCount: 15,
    },
    now: Date.parse("2026-08-27T12:00:00.000Z"),
  });

  assert.equal(proof.stock.observationCount, 2);
  assert.equal(proof.stock.becameTradeCount, 1);
  assert.equal(proof.stock.horizons[1].measuredCount, 2);
  assert.equal(proof.stock.horizons[1].breakoutHitRatePercent, 50);
  assert.equal(proof.stock.horizons[1].averageCloseReturnPercent, 1);
  assert.equal(proof.stock.horizons[1].averagePeakReturnPercent, 6);
  assert.equal(proof.stock.horizons[5].breakoutHitRatePercent, null);
  assert.equal(proof.crypto.horizons[1].breakoutHitRatePercent, 100);
  assert.equal(proof.learning.stock.progressPercent, 6.7);
  assert.equal(proof.discovery.stock.selectedCount, 15);
  assert.equal(JSON.stringify(proof).includes("AAA"), false);
});
