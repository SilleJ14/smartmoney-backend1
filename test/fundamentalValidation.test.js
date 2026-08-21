import test from "node:test";
import assert from "node:assert/strict";
import { scoreValidatedFundamentals, validateFundamentalInputs } from "../scoring/fundamentalValidation.js";

const now = Date.parse("2026-08-21T12:00:00Z");

test("accepts fresh, sourced, finite fundamental inputs", () => {
  const validation = validateFundamentalInputs({ fundamentals: { freeCashFlow: 2_000_000, sharesOutstanding: 1_000_000, revenueGrowth: 0.2, operatingMargin: 0.15, debtToEquity: 0.5, asOf: "2026-08-01T00:00:00Z", provider: "test-provider" } }, { now });
  assert.equal(validation.valid, true);
  assert.equal(scoreValidatedFundamentals(validation).dataUsable, true);
});

test("rejects stale, unsourced, and impossible fundamental inputs", () => {
  const validation = validateFundamentalInputs({ fundamentals: { freeCashFlow: "bogus", sharesOutstanding: -2, revenueGrowth: 99, asOf: "2025-01-01T00:00:00Z" } }, { now });
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((error) => error.code === "STALE_DATA"));
  assert.ok(validation.errors.some((error) => error.code === "MISSING_PROVENANCE"));
  const score = scoreValidatedFundamentals(validation);
  assert.equal(score.dataUsable, false);
  assert.equal(score.fundamentalScore, 50);
});
