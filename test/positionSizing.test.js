import test from "node:test";
import assert from "node:assert/strict";
import { calculateDynamicTradeAmount } from "../risk/positionSizing.js";
const base = { account: { cash: 1000, equity: 1000, buying_power: 1000 }, positions: [], config: { minAutonomousTradeAmount: 25, targetCapitalSlots: 10, maxBotExposurePercent: 80 }, getExposure: () => 0 };
test("conviction changes allocation when loss budget is not the binding limit", () => {
  const roomy = { ...base, config: { ...base.config, maxBotExposurePercent: 10 } };
  assert.ok(calculateDynamicTradeAmount({ ...roomy, signalScore: 92 }) > calculateDynamicTradeAmount({ ...roomy, signalScore: 78 }));
});
test("never exceeds remaining cash", () => {
  const amount = calculateDynamicTradeAmount({ ...base, account: { cash: 30, equity: 1000 }, signalScore: 92 });
  assert.equal(amount, 25);
  assert.ok(amount <= 30);
});
test("rejects sub-threshold signals", () => assert.equal(calculateDynamicTradeAmount({ ...base, signalScore: 60 }), 0));
