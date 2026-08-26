import test from "node:test";
import assert from "node:assert/strict";

import { resolveBoundedScanLimit } from "../engine/scanBudget.js";

test("live scan limit defaults to a bandwidth-safe universe", () => {
  assert.equal(resolveBoundedScanLimit(undefined), 60);
  assert.equal(resolveBoundedScanLimit("not-a-number"), 60);
});

test("live scan limit cannot exceed the hard bandwidth cap", () => {
  assert.equal(resolveBoundedScanLimit(500), 60);
  assert.equal(resolveBoundedScanLimit(25), 25);
  assert.equal(resolveBoundedScanLimit(1), 10);
});
