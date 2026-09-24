import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { calendarForDecision, loadCalendarSnapshot } from "../forex/calendarFeed.js";
import { emptyLedger, createFileStore, createMemoryStore } from "../forex/durableStore.js";
import { updateEquityBaselines, openStopRisk, dailyLossState } from "../forex/accountRisk.js";
import { createExecutionCoordinator } from "../forex/executionCoordinator.js";
import { createSafetySupervisor } from "../forex/safetySupervisor.js";
import { runForexEngineCycle, selectForexSignals } from "../forex/forexEngine.js";
import { resolveStrategyConflict } from "../forex/conflictPolicy.js";
import { FOREX_SPEC } from "../forex/forexSpec.js";

const now = Date.parse("2026-09-22T18:00:00Z");
const calendar = { coverageComplete: true, refreshedAt: new Date(now).toISOString(), events: [] };

test("calendar blocks relevant events, both currencies, and central-bank windows", () => {
  const feed = { ...calendar, events: [{ currency: "USD", type: "FOMC", start: new Date(now + 45 * 60000).toISOString() }] };
  assert.equal(calendarForDecision(feed, { now, instrument: "EUR_USD" }).reason, "EVENT_WINDOW");
  assert.equal(calendarForDecision(feed, { now, instrument: "USD_JPY" }).reason, "EVENT_WINDOW");
  assert.equal(calendarForDecision(feed, { now, instrument: "EUR_GBP" }).ok, true);
});

test("calendar fails closed for missing, stale, future, or malformed coverage", () => {
  for (const feed of [undefined, { ...calendar, refreshedAt: "bad" }, { ...calendar, refreshedAt: new Date(now + 1000).toISOString() },
    { ...calendar, refreshedAt: new Date(now - 16 * 60000).toISOString() }, { ...calendar, events: [{}] },
    { ...calendar, events: [{ currency: "USD", type: "CPI", start: "bad" }] }]) {
    assert.equal(calendarForDecision(feed, { now }).ok, false);
  }
  assert.equal(loadCalendarSnapshot().coverageComplete, false);
  assert.equal(calendarForDecision(calendar, { now }).ok, true);
});

test("file durability requires explicit containment in persistent root and serializes commits", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "forex-regression-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const filePath = path.join(dir, "ledger.json");
  assert.equal(createFileStore({ filePath }).isDurable(), false);
  assert.equal(createFileStore({ filePath, persistentRoot: path.join(dir, "other") }).isDurable(), false);
  const first = createFileStore({ filePath, persistentRoot: dir });
  const second = createFileStore({ filePath, persistentRoot: dir });
  assert.equal(first.isDurable(), true);
  await Promise.all([first.commit(async (ledger) => { await Promise.resolve(); ledger.audits.push("one"); }),
    second.commit((ledger) => ledger.audits.push("two"))]);
  assert.deepEqual((await first.load()).audits, ["one", "two"]);
  assert.deepEqual((await createFileStore({ filePath, persistentRoot: dir }).load()).audits, ["one", "two"]);
});

test("daily baseline rolls at UTC midnight and transfers are applied exactly once", () => {
  const ledger = emptyLedger();
  const account = { id: "a", NAV: 1000, lastTransactionID: "1" };
  updateEquityBaselines(ledger, account, [], now);
  const deposit = [{ id: "2", type: "TRANSFER_FUNDS", amount: "100" }];
  const changed = { ...account, NAV: 1090, lastTransactionID: "2" };
  const first = updateEquityBaselines(ledger, changed, deposit, now + 1000);
  assert.equal(first.cashFlowAdjustedDayStart, 1100);
  assert.equal(first.peakEquity, 1100);
  assert.equal(updateEquityBaselines(ledger, changed, deposit, now + 2000).cashFlowAdjustedDayStart, 1100);
  const withdrawal = [{ id: "3", type: "TRANSFER_FUNDS", amount: "-100" }];
  assert.equal(updateEquityBaselines(ledger, { ...changed, NAV: 990, lastTransactionID: "3" }, withdrawal, now + 3000).cashFlowAdjustedDayStart, 1000);
  const next = updateEquityBaselines(ledger, { ...changed, NAV: 990, lastTransactionID: "3" }, [], now + 86400000);
  assert.equal(next.dayStartEquity, 990);
  assert.equal(next.dailySession, "2026-09-23");
});

test("invalid equity cannot create fresh risk capacity", () => {
  assert.equal(dailyLossState({ equity: 0, dayStartEquity: 1000 }).locked, true);
});

test("stop risk uses executable prices and account-loss conversion, not margin", () => {
  const result = openStopRisk({ equity: 10000, accountCurrency: "USD",
    trades: [{ instrument: "EUR_USD", currentUnits: 1000, stopLossOrder: { price: 1.09 } },
      { instrument: "USD_JPY", currentUnits: -1000, stopLossOrder: { price: 151 } }],
    prices: [{ instrument: "EUR_USD", bid: 1.1, ask: 1.1001 }, { instrument: "USD_JPY", bid: 149.99, ask: 150 }],
    homeConversions: [{ currency: "JPY", accountLoss: 0.0067 }] });
  assert.ok(Math.abs(result.amount - 16.7) < 1e-8);
  assert.ok(Math.abs(result.percent - 0.167) < 1e-8);
  assert.equal(openStopRisk({ equity: 10000, accountCurrency: "USD", trades: [{ instrument: "USD_JPY", currentUnits: 10 }] }).percent, null);
});

test("pending entry orders or missing broker response block recovery", async () => {
  const supervisor = createSafetySupervisor({ store: createMemoryStore({ treatAsDurable: true }) });
  const input = { credentialsOk: true, accountSnapshot: { id: "a" }, lastTransactionId: "1", historyLoaded: true, forexAutoEnabled: true };
  assert.equal((await supervisor.recover(input)).halt, "PENDING_ORDERS_UNVERIFIED");
  assert.equal((await supervisor.recover({ ...input, pendingOrders: [{ type: "LIMIT" }] })).executionReady, false);
  assert.equal((await supervisor.recover({ ...input, pendingOrders: [] })).executionReady, true);
});

test("incident locks allow only broker-verified reductions; partial reductions do not close full trade", async () => {
  const calls = [];
  const coordinator = createExecutionCoordinator({ store: createMemoryStore({ treatAsDurable: true }), adapter: {
    async getOpenTrades() { return { trades: [{ id: "t", instrument: "EUR_USD", currentUnits: 1000 }] }; },
    async closeTrade(id) { calls.push(id); return { orderFillTransaction: { id: "21", type: "ORDER_FILL", orderID: "20", units: "-1000", tradesClosed: [{ tradeID: "t", units: "1000", price: "1.1" }] } }; },
    async createMarketOrder(order) { calls.push(order); return { orderFillTransaction: { id: "23", type: "ORDER_FILL", orderID: "22", units: "-500", tradeReduced: { tradeID: "t", units: "500", price: "1.1" } } }; },
  } });
  const plan = { intent: "close", brokerTradeId: "t", accountId: "a", instrumentId: "EUR_USD", units: -1000,
    executionReady: false, incidentLockActive: true, pauseEntries: true };
  assert.equal((await coordinator.submit(plan)).ok, true);
  assert.deepEqual(calls, ["t"]);
  assert.equal((await coordinator.submit({ ...plan, units: -500 })).ok, true);
  assert.equal(calls[1].reduceOnly, true);
  assert.equal(calls[1].units, -500);
  assert.equal((await coordinator.submit({ ...plan, units: -2000 })).reason, "CLOSE_WOULD_OPEN");
  assert.equal((await coordinator.submit({ ...plan, environment: "LIVE" })).reason, "LIVE_BLOCKED");
  assert.equal((await coordinator.submit({ ...plan, intent: "automatic" })).ok, false);
});

test("conflict decisions are reflected in final signals", () => {
  const rows = ["buy", "sell"].map((side) => ({ identity: "a:EUR_USD", instrument: "EUR_USD", side, state: "EXECUTION_ELIGIBLE" }));
  resolveStrategyConflict(rows);
  const signals = selectForexSignals(rows.map((row) => ({ instrument: row.instrument, identity: row.identity, row, quote: {}, result: {} })), new Map(), {});
  assert.equal(signals[0].forexState, "blocked");
  assert.equal(signals[0].reason, "STRATEGY_CONFLICT");
  assert.equal(signals[0].raw.forexGates.entry, false);
});

test("engine fetches pending orders, advances replay cursor, and reports elapsed quote age without submitting", async () => {
  let time = now;
  let pendingCalls = 0;
  const cursors = [];
  const client = { token: "test", accountId: "a", liveHost: false,
    async getAccount() { return { account: { id: "a", NAV: 1000, balance: 1000, currency: "USD", lastTransactionID: "10" } }; },
    async getOpenTrades() { return { trades: [] }; },
    async getPendingOrders() { pendingCalls++; return { orders: [] }; },
    async getTransactionsSince(id) { cursors.push(String(id)); return { transactions: [] }; },
    async getPrices(instruments) { return { prices: instruments.map((instrument) => ({ instrument, time: new Date(now).toISOString(), bids: [{ price: 1.1 }], asks: [{ price: 1.1001 }], tradeable: true })) }; },
    async getCandles() { time += 1000; return { candles: [] }; },
    async createMarketOrder() { assert.fail("scan must not submit"); },
  };
  const store = createMemoryStore({ treatAsDurable: true });
  const input = { client, store, now, clockNow: () => time, calendar, forexAutoEnabled: true, spec: { ...FOREX_SPEC, scanInstruments: ["EUR_USD"] } };
  const snapshot = await runForexEngineCycle(input);
  assert.equal(pendingCalls, 1);
  assert.equal(snapshot.quoteAgeSeconds, 4); // Three strategy histories plus optional daily display history.
  assert.equal(snapshot.halt, "STALE_PRICE");
  // The existing practice-host mode label describes configuration, not
  // permission to submit. Stale evidence must still deny authorization below.
  assert.equal(snapshot.executionMode, "PRACTICE_ORDERS");
  assert.equal(snapshot.executionReady, false);
  assert.equal(snapshot.autoTradingAuthorized, false);
  await runForexEngineCycle(input);
  assert.deepEqual(cursors, ["0", "10"]);
});
