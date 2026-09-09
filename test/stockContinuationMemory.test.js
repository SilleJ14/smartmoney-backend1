import test from "node:test";
import assert from "node:assert/strict";
import { updateStockContinuationSession } from "../scoring/stockContinuationMemory.js";

test("continuation evidence is counted at most once per trading session", () => {
  const first = updateStockContinuationSession({}, {
    dayKey: "2026-08-24",
    accumulationEvent: true,
    stealthVolumeEvent: true,
    supportHoldEvent: true,
  });
  const repeated = updateStockContinuationSession(first, {
    dayKey: "2026-08-24",
    accumulationEvent: true,
    stealthVolumeEvent: true,
    supportHoldEvent: true,
    failedBreakoutEvent: true,
  });

  assert.equal(first.sessionCounted, true);
  assert.equal(repeated.sessionCounted, false);
  assert.equal(repeated.accumulationEvents, 1);
  assert.equal(repeated.stealthVolumeEvents, 1);
  assert.equal(repeated.supportHoldEvents, 1);
  assert.equal(repeated.failedBreakoutEvents, 1);
  assert.deepEqual(repeated.seenDays, ["2026-08-24"]);
});

test("continuation evidence advances once on the next session and repairs inflated legacy counts", () => {
  const next = updateStockContinuationSession(
    {
      seenDays: ["2026-08-21", "2026-08-24"],
      accumulationEvents: 99,
      stealthVolumeEvents: 40,
      supportHoldEvents: 2,
      failedBreakoutEvents: 8,
    },
    {
      dayKey: "2026-08-25",
      accumulationEvent: true,
      supportHoldEvent: true,
    }
  );

  assert.equal(next.sessionCounted, true);
  assert.equal(next.accumulationEvents, 3);
  assert.equal(next.stealthVolumeEvents, 2);
  assert.equal(next.supportHoldEvents, 3);
  assert.equal(next.failedBreakoutEvents, 2);
  assert.deepEqual(next.seenDays, ["2026-08-21", "2026-08-24", "2026-08-25"]);
});

test("later evidence in the same session is merged without scan-count inflation", () => {
  const quietOpen = updateStockContinuationSession({}, {
    dayKey: "2026-08-25",
  });
  const laterAccumulation = updateStockContinuationSession(quietOpen, {
    dayKey: "2026-08-25",
    accumulationEvent: true,
    supportHoldEvent: true,
  });
  const repeated = updateStockContinuationSession(laterAccumulation, {
    dayKey: "2026-08-25",
    accumulationEvent: true,
    supportHoldEvent: true,
  });

  assert.equal(laterAccumulation.accumulationEvents, 1);
  assert.equal(laterAccumulation.supportHoldEvents, 1);
  assert.equal(repeated.accumulationEvents, 1);
  assert.equal(repeated.supportHoldEvents, 1);
  assert.equal(repeated.sessionEvidence[0].accumulationEvent, true);
});

test("weekend observations cannot become continuation sessions", () => {
  const friday = updateStockContinuationSession({}, {
    dayKey: "2026-08-21",
    accumulationEvent: true,
  });
  const saturday = updateStockContinuationSession(friday, {
    dayKey: "2026-08-22",
    accumulationEvent: true,
  });

  assert.deepEqual(saturday.seenDays, ["2026-08-21"]);
  assert.equal(saturday.accumulationEvents, 1);
  assert.equal(saturday.sessionCounted, false);
});
