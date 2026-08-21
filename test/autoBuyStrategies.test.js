import test from "node:test";
import assert from "node:assert/strict";
import { createAutoBuyStrategies } from "../strategies/autoBuyStrategies.js";

test("auto-buy strategies read trading mode at invocation time", async () => {
  let mode = "paper";
  let clockCalls = 0;
  const strategies = createAutoBuyStrategies({
    getTradingMode: () => mode,
    resetDailyMorningTradeCounter() {},
    canTakeMoreMorningTrades: () => true,
    getClock: async () => {
      clockCalls += 1;
      return { is_open: false };
    },
    recordOrder() {},
  });

  await strategies.autoBuySignals([]);
  assert.equal(clockCalls, 0);

  mode = "live_stock";
  await strategies.autoBuySignals([]);
  assert.equal(clockCalls, 1);
});

test("crypto auto-buy exits before broker access outside live modes", async () => {
  const strategies = createAutoBuyStrategies({
    getTradingMode: () => "paper",
    getAccount: async () => assert.fail("broker should not be called"),
  });

  await strategies.autoBuyCryptoSignals([]);
});
