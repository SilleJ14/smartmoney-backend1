import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createMemoryStore, emptyLedger } from "../forex/durableStore.js";
import { ingestTransactions } from "../forex/fills.js";
import { createSafetySupervisor } from "../forex/safetySupervisor.js";
import { createExecutionCoordinator } from "../forex/executionCoordinator.js";
import { orderOutcome } from "../forex/orderOutcome.js";
import { registerOperationalControlRoutes } from "../routes/operationalControlRoutes.js";

const fill = { id: "12", type: "ORDER_FILL", accountID: "a", orderID: "11", clientOrderID: "client-1", instrument: "EUR_USD",
  units: "100", tradeOpened: { tradeID: "12", units: "100", price: "1.1" } };
const recovery = { credentialsOk: true, accountSnapshot: { id: "a" }, lastTransactionId: "12", historyLoaded: true,
  forexAutoEnabled: true, pendingOrders: [], transactions: [fill], openTrades: [{ id: "12", instrument: "EUR_USD", currentUnits: "100", stopLossOrder: { price: "1.09" } }] };

test("latest server pause overrides a stale unpaused order plan", async () => {
  let called = false;
  const coordinator = createExecutionCoordinator({ store: createMemoryStore({ treatAsDurable: true }), getEntryPause: () => true,
    adapter: { async createMarketOrder() { called = true; throw new Error("must not submit"); } } });
  const result = await coordinator.submit({ intent: "manual", executionReady: true, pauseEntries: false, accountId: "a",
    instrumentId: "EUR_USD", units: 100, currentUnits: 0, quoteOk: true,
    priceBound: "1.1002", stopLossOnFill: "1.09", takeProfitOnFill: "1.13", worstEntryPrice: 1.1001, stop: 1.09,
    bid: 1.1, ask: 1.1001, A: 0.01, allowedRisk: 12.5, remainingDailyRisk: 1, plannedRiskPercent: 0.25,
    openPlusPendingPercent: 0, sameDirectionPercent: 0, marginAvailable: 4000, requiredMargin: 10, instrument: { minimumTradeSize: 1 } });
  assert.equal(result.reason, "ENTRIES_PAUSED");
  assert.equal(called, false);
});

test("OANDA replay links fills to account-scoped intents and is idempotent", () => {
  const ledger = emptyLedger();
  ledger.intents.push({ intentId: "i", accountId: "a", clientOrderId: "client-1", state: "OUTCOME_UNKNOWN" });
  ledger.reservations.push({ intentId: "i", state: "RESERVED" });
  // Old versions marked transactions seen without persisting their fills.
  ledger.seenTransactions.a = { "12": true };
  ingestTransactions(ledger, "a", [fill, fill]);
  assert.equal(ledger.fills.length, 1);
  assert.equal(ledger.fills[0].intentId, "i");
  assert.equal(ledger.intents[0].state, "FILLED");
  assert.equal(ledger.reservations[0].state, "CONSUMED");
  const close = { ...fill, id: "13", tradeOpened: undefined, tradeReduced: { tradeID: "12", units: "40", price: "1.2" } };
  ingestTransactions(ledger, "a", [close, close]);
  assert.equal(ledger.fills.length, 2);
  assert.equal(ledger.fills[1].action, "REDUCED");
  assert.throws(() => ingestTransactions(ledger, "other", [fill]), /ACCOUNT_MISMATCH/);
});

test("known bot positions recover; external positions remain blocked", async () => {
  const store = createMemoryStore({ treatAsDurable: true });
  await store.commit((ledger) => ledger.intents.push({ intentId: "i", accountId: "a", clientOrderId: "client-1", state: "OUTCOME_UNKNOWN" }));
  const supervisor = createSafetySupervisor({ store });
  assert.equal((await supervisor.recover(recovery)).executionReady, true);
  const external = createSafetySupervisor({ store: createMemoryStore({ treatAsDurable: true }) });
  assert.equal((await external.recover(recovery)).halt, "UNEXPLAINED_POSITION");
});

test("pause route feeds persistent recovery state, resume requires confirmation", async () => {
  let config = {};
  const routes = new Map();
  registerOperationalControlRoutes({ post: (url, ...handlers) => routes.set(url, handlers.at(-1)) }, {
    requireAdmin() {}, getControlState: () => config, updateControlState: (updates) => (config = { ...config, ...updates }), saveEngineState() {},
  });
  const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  routes.get("/forex-entries/pause")({ body: {} }, res);
  assert.equal(config.forexPauseEntries, true);
  const store = createMemoryStore({ treatAsDurable: true });
  const supervisor = createSafetySupervisor({ store });
  const input = { ...recovery, transactions: [], openTrades: [] };
  let result = await supervisor.recover({ ...input, entryPauseRequested: config.forexPauseEntries });
  assert.equal(result.pauseEntries, true);
  assert.equal(result.autoTradingAuthorized, false);
  assert.equal((await store.load()).pauseEntries.a, true);
  routes.get("/forex-entries/resume")({ body: { confirmation: "wrong" } }, res);
  assert.equal(res.code, 400);
  assert.equal(config.forexPauseEntries, true);
  routes.get("/forex-entries/resume")({ body: { confirmation: "RESUME FOREX ENTRIES" } }, res);
  result = await supervisor.recover({ ...input, entryPauseRequested: config.forexPauseEntries });
  assert.equal(result.pauseEntries, false);
  const source = fs.readFileSync(new URL("../server.js", import.meta.url), "utf8");
  assert.match(source, /forexPauseEntries: nextForexPause/);
  assert.match(source, /getEntryPause: \(\) => runtimeConfig.forexPauseEntries === true/);
});

test("FOK response classification rejects cancellations and ambiguous success", () => {
  assert.equal(orderOutcome({ orderFillTransaction: fill }).state, "FILLED");
  assert.equal(orderOutcome({ orderCancelTransaction: { id: "5", type: "ORDER_CANCEL" } }).state, "CANCELLED");
  assert.equal(orderOutcome({}).state, "OUTCOME_UNKNOWN");
  assert.equal(orderOutcome({ orderFillTransaction: { id: "1" } }).state, "OUTCOME_UNKNOWN");
  assert.equal(orderOutcome({ orderCreateTransaction: { id: "1" } }).state, "OUTCOME_UNKNOWN");
});

for (const state of ["FILLED", "CANCELLED", "REJECTED", "OUTCOME_UNKNOWN", "NETWORK_ERROR"]) {
  test(`coordinator handles ${state} without false success or premature risk release`, async () => {
    const store = createMemoryStore({ treatAsDurable: true });
    const coordinator = createExecutionCoordinator({ store, adapter: {
      async getOpenTrades() { return { trades: [{ id: "t", instrument: "EUR_USD", currentUnits: "100" }] }; },
      async closeTrade() {
        if (state === "NETWORK_ERROR") throw new TypeError("connection reset");
        if (state === "FILLED") return { orderFillTransaction: { ...fill, units: "-100", tradeOpened: undefined, tradesClosed: [{ tradeID: "t", units: "100", price: "1.1" }] } };
        if (state === "CANCELLED") return { orderCancelTransaction: { id: "14", type: "ORDER_CANCEL", orderID: "11", reason: "PRICE_BOUND_EXCEEDED" } };
        if (state === "REJECTED") throw Object.assign(new Error("rejected"), { data: { orderRejectTransaction: { id: "15", type: "MARKET_ORDER_REJECT", rejectReason: "INSUFFICIENT_MARGIN" } } });
        return {};
      },
    } });
    const result = await coordinator.submit({ intent: "close", accountId: "a", brokerTradeId: "t", instrumentId: "EUR_USD", units: -100, clientRequestId: "once" });
    assert.equal(result.ok, state === "FILLED");
    assert.equal(result.state, state === "NETWORK_ERROR" ? "OUTCOME_UNKNOWN" : state);
    const ledger = await store.load();
    assert.equal(ledger.reservations[0].state, state === "FILLED" ? "CONSUMED" : ["CANCELLED", "REJECTED"].includes(state) ? "RELEASED" : "RESERVED");
    if (["NETWORK_ERROR", "OUTCOME_UNKNOWN"].includes(state)) {
      assert.equal((await createSafetySupervisor({ store }).recover({ ...recovery, openTrades: [], transactions: [] })).halt, "UNCERTAIN_ORDER");
    }
  });
}
