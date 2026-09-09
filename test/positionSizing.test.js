import test from "node:test";
import assert from "node:assert/strict";
import { calculateDynamicTradeAmount } from "../risk/positionSizing.js";
const base = { account: { cash: 1000, equity: 1000, buying_power: 1000 }, positions: [], config: { minAutonomousTradeAmount: 25, targetCapitalSlots: 10, maxBotExposurePercent: 80 }, getExposure: () => 0 };
test("sizes elite signals above normal signals", () => {
  assert.ok(calculateDynamicTradeAmount({ ...base, signalScore: 92 }) > calculateDynamicTradeAmount({ ...base, signalScore: 78 }));
});
test("never exceeds remaining cash", () => {
  assert.equal(calculateDynamicTradeAmount({ ...base, account: { cash: 30, equity: 1000 }, signalScore: 92 }), 30);
});
test("rejects sub-threshold signals", () => assert.equal(calculateDynamicTradeAmount({ ...base, signalScore: 60 }), 0));
