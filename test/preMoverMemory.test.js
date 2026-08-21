import test from "node:test";
import assert from "node:assert/strict";
import { prunePreMoverMemory } from "../discovery/preMoverMemory.js";

test("pre-mover memory keeps the newest bounded entries", () => {
  const input = {
    OLD: { lastSeenAt: "2026-08-18T20:00:00Z" },
    NEW: { lastSeenAt: "2026-08-20T20:00:00Z" },
    MID: { lastSeenAt: "2026-08-19T20:00:00Z" },
  };
  const result = prunePreMoverMemory(input, 2);
  assert.deepEqual(Object.keys(result.memory), ["NEW", "MID"]);
  assert.equal(result.removedCount, 1);
});

