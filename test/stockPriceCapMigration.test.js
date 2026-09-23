import test from "node:test";
import assert from "node:assert/strict";
import { migrateStockPriceCapPreference } from "../discovery/stockPriceCapMigration.js";

test("startup price-cap migration defaults missing values and preserves valid preferences", () => {
  for (const maxStockPrice of [undefined, null, "", "invalid", 0, -1]) {
    assert.equal(migrateStockPriceCapPreference({ maxStockPrice }).maxStockPrice, 50);
  }
  assert.equal(migrateStockPriceCapPreference({ maxStockPrice: 1000 }).maxStockPrice, 1000);
  assert.equal(migrateStockPriceCapPreference({ maxStockPrice: 0.5 }).maxStockPrice, 0.5);
});

test("startup migration is idempotent and preserves unrelated settings", () => {
  const original = { maxStockPrice: 100, forexAutoEnabled: false };
  const migrated = migrateStockPriceCapPreference(original);
  assert.equal(original.stockPriceCapPolicyVersion, undefined);
  assert.equal(migrated.forexAutoEnabled, false);
  assert.equal(migrated.stockPriceCapPolicyVersion, 2);
  assert.equal(migrateStockPriceCapPreference(migrated), migrated);
});
