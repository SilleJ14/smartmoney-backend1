import test from "node:test";
import assert from "node:assert/strict";
import { scoreValidatedFundamentals, validateFundamentalInputs } from "../scoring/fundamentalValidation.js";

const now = Date.parse("2026-08-21T12:00:00Z");
const normalizedMetadata = {
  reportingPeriod: "TTM",
  currency: "USD",
  freeCashFlowUnit: "USD",
  sharesUnit: "shares",
  sharesBasis: "diluted",
};

test("accepts fresh, sourced, finite fundamental inputs", () => {
  const validation = validateFundamentalInputs({ current: 20, fundamentals: { ...normalizedMetadata, freeCashFlow: 2_000_000, sharesOutstanding: 1_000_000, revenueGrowth: 0.2, operatingMargin: 0.15, debtToEquity: 0.5, asOf: "2026-08-01T00:00:00Z", provider: "test-provider" } }, { now });
  assert.equal(validation.valid, true);
  const result = scoreValidatedFundamentals(validation);
  assert.equal(result.dataUsable, true);
  assert.equal(result.freeCashFlowYield, 0.1);
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

test("rejects sparse fundamentals and missing market price", () => {
  const sparse = validateFundamentalInputs({
    fundamentals: {
      freeCashFlow: 2_000_000,
      sharesOutstanding: 1_000_000,
      asOf: "2026-08-01T00:00:00Z",
      provider: "test-provider",
    },
  }, { now });
  assert.equal(sparse.valid, false);
  assert.ok(sparse.errors.some((error) => error.code === "INSUFFICIENT_FIELD_COVERAGE"));
  assert.ok(sparse.errors.some((error) => error.code === "MISSING_OR_INVALID_MARKET_PRICE"));
});

test("cash-flow yield scoring accounts for the stock price", () => {
  const fundamentals = {
    ...normalizedMetadata,
    freeCashFlow: 2_000_000,
    sharesOutstanding: 1_000_000,
    revenueGrowth: 0.1,
    operatingMargin: 0.1,
    debtToEquity: 0.5,
    asOf: "2026-08-01T00:00:00Z",
    provider: "test-provider",
  };
  const inexpensive = scoreValidatedFundamentals(
    validateFundamentalInputs({ current: 20, fundamentals }, { now })
  );
  const expensive = scoreValidatedFundamentals(
    validateFundamentalInputs({ current: 200, fundamentals }, { now })
  );
  assert.ok(inexpensive.fundamentalScore > expensive.fundamentalScore);
});

test("rejects ambiguous fundamental period, units, currency, and share basis", () => {
  const validation = validateFundamentalInputs({
    current: 20,
    fundamentals: {
      freeCashFlow: 2_000_000,
      sharesOutstanding: 1_000_000,
      revenueGrowth: 0.1,
      operatingMargin: 0.1,
      debtToEquity: 0.5,
      asOf: "2026-08-01T00:00:00Z",
      provider: "test-provider",
      reportingPeriod: "Q1",
      currency: "EUR",
      freeCashFlowUnit: "millions",
      sharesUnit: "millions",
      sharesBasis: "basic",
    },
  }, { now });
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((error) => error.code === "MISSING_OR_UNSUPPORTED_REPORTING_PERIOD"));
  assert.ok(validation.errors.some((error) => error.code === "FUNDAMENTAL_CURRENCY_MUST_BE_USD"));
  assert.ok(validation.errors.some((error) => error.code === "FREE_CASH_FLOW_UNIT_MUST_BE_USD"));
  assert.ok(validation.errors.some((error) => error.code === "SHARES_UNIT_MUST_BE_SHARES"));
  assert.ok(validation.errors.some((error) => error.code === "MISSING_OR_UNSUPPORTED_SHARES_BASIS"));
});
