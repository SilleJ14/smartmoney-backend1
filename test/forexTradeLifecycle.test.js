import test from "node:test";
import assert from "node:assert/strict";
import { evaluateForexTradeLifecycle } from "../forex/tradeLifecycle.js";
import { createExecutionCoordinator } from "../forex/executionCoordinator.js";
import { createMemoryStore } from "../forex/durableStore.js";

function longTrade(overrides = {}) {
  return {
    id: "t-1",
    instrument: "EUR_USD",
    currentUnits: "1000",
    price: "1.1000",
    stopLossOrder: { price: "1.0980" },
    takeProfitOrder: { price: "1.1050" },
    ...overrides,
  };
}

test("forex lifecycle keeps unavailable evidence explicit", () => {
  const result = evaluateForexTradeLifecycle({ trade: longTrade(), quote: {} });
  assert.equal(result.action, "WAIT");
  assert.equal(result.available, false);
  assert.ok(result.reasons.includes("EXECUTABLE_QUOTE_UNAVAILABLE"));
  assert.equal(result.rMultiple, null);
});

test("event and weekly-close exits take priority over profit management", () => {
  const event = evaluateForexTradeLifecycle({
    trade: longTrade(),
    quote: { bid: 1.1040, ask: 1.1041 },
    atr: 0.001,
    eventGate: { reason: "EVENT_WINDOW" },
  });
  assert.equal(event.action, "CLOSE_FULL");
  assert.equal(event.reason, "EVENT_WINDOW");
  assert.equal(event.units, -1000);

  const weekly = evaluateForexTradeLifecycle({
    trade: longTrade(),
    quote: { bid: 1.1040, ask: 1.1041 },
    atr: 0.001,
    session: { tooCloseToWeeklyClose: true },
  });
  assert.equal(weekly.reason, "WEEKLY_CLOSE");
});

test("lifecycle takes a bounded partial before trailing", () => {
  const result = evaluateForexTradeLifecycle({
    trade: longTrade(),
    quote: { bid: 1.1026, ask: 1.1027 },
    atr: 0.001,
  });
  assert.equal(result.action, "CLOSE_PARTIAL");
  assert.equal(result.units, -500);
  assert.equal(result.fraction, 0.5);
});

test("lifecycle moves protection to structure and volatility after partial", () => {
  const result = evaluateForexTradeLifecycle({
    trade: longTrade(),
    quote: { bid: 1.1040, ask: 1.1041 },
    atr: 0.001,
    structure: { support: 1.1020 },
    managementState: { partialTaken: true, initialStop: 1.0980 },
  });
  assert.equal(result.action, "UPDATE_PROTECTION");
  assert.equal(result.reason, "STRUCTURE_VOLATILITY_TRAIL");
  assert.ok(result.stop >= 1.1020);
  assert.ok(result.stop < 1.1040);
});

test("short lifecycle never moves a stop away from the market", () => {
  const result = evaluateForexTradeLifecycle({
    trade: longTrade({
      currentUnits: "-1000",
      price: "1.1000",
      stopLossOrder: { price: "1.1020" },
      takeProfitOrder: { price: "1.0950" },
    }),
    quote: { bid: 1.0960, ask: 1.0961 },
    atr: 0.001,
    structure: { resistance: 1.0980 },
    managementState: { partialTaken: true, initialStop: 1.1020 },
  });
  assert.equal(result.action, "UPDATE_PROTECTION");
  assert.ok(result.stop <= 1.0980);
  assert.ok(result.stop > 1.0961);
});

test("practice management replace and cancel are broker-verified and idempotent", async () => {
  const store = createMemoryStore({ treatAsDurable: true });
  let replacements = 0;
  let cancellations = 0;
  const adapter = {
    liveHost: false,
    async getOpenTrades() { return { trades: [longTrade()] }; },
    async replaceTradeDependentOrders() { replacements += 1; return { ok: true }; },
    async getPendingOrders() { return { orders: [{ id: "order-1" }] }; },
    async cancelOrder() { cancellations += 1; return { ok: true }; },
  };
  await store.commit(ledger => {
    ledger.intents.push({
      intentId: "intent-1", accountId: "practice", brokerOrderId: "order-1",
      state: "ACKNOWLEDGED",
    });
    ledger.reservations.push({ intentId: "intent-1", state: "RESERVED", risk: 0.5 });
  });
  const coordinator = createExecutionCoordinator({ adapter, store, nowFn: () => Date.parse("2026-10-02T00:00:00Z") });
  const protection = {
    accountId: "practice", environment: "FORWARD_PRACTICE",
    brokerTradeId: "t-1", instrumentId: "EUR_USD",
    stopLossPrice: 1.099, takeProfitPrice: 1.105,
    clientRequestId: "protect-1",
  };
  assert.equal((await coordinator.replaceProtection(protection)).state, "REPLACED");
  assert.equal((await coordinator.replaceProtection(protection)).reason, "DUPLICATE_MANAGEMENT");
  assert.equal(replacements, 1);
  assert.equal((await coordinator.replaceProtection({ ...protection, clientRequestId: "loosen", stopLossPrice: 1.097 })).reason, "STOP_LOOSENING_FORBIDDEN");

  assert.equal((await coordinator.cancel({ accountId: "practice", orderId: "order-1" })).state, "CANCELLED");
  assert.equal(cancellations, 1);
  const ledger = await store.load();
  assert.equal(ledger.intents[0].state, "CANCELLED");
  assert.equal(ledger.reservations[0].state, "RELEASED");
});
