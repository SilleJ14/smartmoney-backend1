import test from "node:test";
import assert from "node:assert/strict";
import {
  getEffectiveTradingMode,
  resolveAutoTradingEnabled,
  sanitizeRuntimeConfig,
} from "../config/runtimePolicy.js";

test("runtime config enforces the institutional score floor", () => {
  assert.equal(sanitizeRuntimeConfig({ minScoreToBuy: 42 }).minScoreToBuy, 70);
  assert.equal(sanitizeRuntimeConfig({ minScoreToBuy: 82 }).minScoreToBuy, 82);
});

test("unknown trading modes fail safely to stocks", () => {
  assert.equal(getEffectiveTradingMode("smart"), "smart");
  assert.equal(getEffectiveTradingMode("unknown"), "live_stock");
});

test("environment automation setting overrides persisted config", () => {
  assert.equal(resolveAutoTradingEnabled({ autoTradingEnabled: true }, "false"), false);
  assert.equal(resolveAutoTradingEnabled({ autoTradingEnabled: true }, undefined), true);
});
