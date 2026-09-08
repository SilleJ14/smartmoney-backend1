import test from "node:test";
import assert from "node:assert/strict";
import { processBatches } from "../utils/processBatches.js";

test("processBatches runs bounded concurrent batches and never sleeps after the final batch", async () => {
  const sleepCalls = [];
  let active = 0;
  let peakActive = 0;
  const results = await processBatches(
    [1, 2, 3, 4, 5],
    2,
    async (value) => {
      active += 1;
      peakActive = Math.max(peakActive, active);
      await Promise.resolve();
      active -= 1;
      return value === 3 ? null : value * 10;
    },
    {
      delayMs: 125,
      sleepFn: async (ms) => { sleepCalls.push(ms); },
    }
  );

  assert.equal(peakActive, 2);
  assert.deepEqual(sleepCalls, [125, 125]);
  assert.deepEqual(results, [10, 20, 40, 50]);
});
