import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { FOREX_SPEC } from "../forex/forexSpec.js";
import { canonicalAccountId, classifyPositionEffect, isOpeningRisk, resolveAssetClass } from "../forex/identity.js";
import { wilderAtr } from "../forex/indicators.js";
import { confirmedSwings } from "../forex/swings.js";
import { evaluateBreakoutRetest } from "../forex/strategies/breakoutRetest.js";
import { createApprovalRegistry, mayAutoExecute } from "../forex/approvalRegistry.js";
import { createExecutionCoordinator } from "../forex/executionCoordinator.js";
import { createSafetySupervisor } from "../forex/safetySupervisor.js";
import { forexEvidencePolicy } from "../forex/evidenceValidator.js";
import { permittedUnits } from "../forex/riskManager.js";
import { calendarAllowsEntry } from "../forex/calendarService.js";
import { runForexEngineCycle } from "../forex/forexEngine.js";
import { createOandaClient } from "../forex/oandaClient.js";

function candle(c, extras = {}) {
  return { t: extras.t || "2026-01-01T00:00:00.000Z", o: c, h: c + 0.0004, l: c - 0.0004, c, complete: true, ...extras };
}

test("canonical identity and USD pairs are not crypto without metadata", () => {
  const id = canonicalAccountId({
    environment: "practice",
    broker: "oanda",
    accountId: "101-001",
    assetClass: "forex",
    instrumentId: "EUR_USD",
  });
  assert.equal(id, "practice:oanda:101-001:forex:EUR_USD");
  assert.equal(resolveAssetClass({ assetClass: "forex", symbol: "EUR/USD" }), "forex");
  assert.throws(() => resolveAssetClass({ symbol: "EUR/USD" }), /ASSET_CLASS_REQUIRED/);
});

test("selling EUR/USD with no position is opening-risk", () => {
  const effect = classifyPositionEffect({ currentUnits: 0, orderUnits: -1000 });
  assert.equal(effect, "OPENING_SHORT");
  assert.equal(isOpeningRisk(effect), true);
  assert.equal(classifyPositionEffect({ currentUnits: 1000, orderUnits: -400 }), "REDUCING");
});

test("Wilder ATR is deterministic", () => {
  const rows = Array.from({ length: 20 }, (_, i) => candle(1 + i * 0.01, { h: 1 + i * 0.01 + 0.02, l: 1 + i * 0.01 - 0.01 }));
  const first = wilderAtr(rows, 14);
  const second = wilderAtr(rows, 14);
  assert.equal(first.atr, second.atr);
  assert.ok(first.atr > 0);
});

test("swings are only known after two later candles close", () => {
  const rows = [
    candle(1.10, { h: 1.10, l: 1.09 }),
    candle(1.11, { h: 1.11, l: 1.10 }),
    candle(1.20, { h: 1.25, l: 1.19 }),
    candle(1.12, { h: 1.13, l: 1.11 }),
    candle(1.11, { h: 1.12, l: 1.10 }),
  ];
  const swings = confirmedSwings(rows);
  assert.equal(swings.highs.length, 1);
  assert.equal(swings.highs[0].knownAtIndex, 4);
  assert.equal(confirmedSwings(rows.slice(0, 4)).highs.length, 0);
});

test("unknown evidence combinations fail closed", () => {
  assert.throws(() => forexEvidencePolicy("forex", "magic", "automatic"), /UNKNOWN_EVIDENCE_POLICY/);
  const policy = forexEvidencePolicy("forex", "order", "automatic");
  assert.equal(policy.quote.providerMaxAgeSeconds, 2);
});

test("strategy registry starts in research so auto execution is denied", () => {
  const registry = createApprovalRegistry();
  assert.equal(mayAutoExecute(registry, "FOREX_BREAKOUT_RETEST_V1", "FORWARD_PRACTICE"), false);
  assert.equal(mayAutoExecute(registry, "FOREX_TREND_CONTINUATION_V1", "LIVE"), false);
});

test("execution coordinator is the only order path and blocks without durable storage", async () => {
  let submitted = 0;
  const coordinator = createExecutionCoordinator({
    adapter: { createMarketOrder: async () => { submitted += 1; return { ok: true }; } },
    registry: createApprovalRegistry(),
    durableStorageAvailable: false,
  });
  const result = await coordinator.submit({
    executionReady: true,
    autoTradingAuthorized: true,
    strategyId: "FOREX_BREAKOUT_RETEST_V1",
    environment: "FORWARD_PRACTICE",
    units: -1000,
    currentUnits: 0,
    priceBound: "1.08",
    stopLossOnFill: "1.09",
  });
  assert.equal(result.reason, "DURABLE_STORAGE_UNAVAILABLE");
  assert.equal(submitted, 0);
});

test("startup recovery never marks execution ready without durable storage", async () => {
  const supervisor = createSafetySupervisor({ durableStorageAvailable: false });
  const recovered = await supervisor.recover({
    credentialsOk: true,
    accountSnapshot: { id: "1" },
    lastTransactionId: "10",
    missedTransactionsRecovered: true,
    protectionVerified: true,
    historyLoaded: true,
    forexAutoEnabled: true,
    incidentLockActive: false,
  });
  assert.equal(recovered.analysisReady, true);
  assert.equal(recovered.executionReady, false);
  assert.equal(recovered.autoTradingAuthorized, false);
});

test("live OANDA host remains forbidden", async () => {
  const client = createOandaClient({ accountId: "x", token: "y", baseUrl: "https://api-fxtrade.oanda.com" });
  await assert.rejects(() => client.createMarketOrder({
    instrument: "EUR_USD", units: -1, priceBound: "1", stopLossPrice: "1.1",
  }), /LIVE_FOREX/);
});

test("engine scan does not call the broker order API", async () => {
  const now = Date.parse("2026-09-22T18:00:00.000Z");
  const bars = Array.from({ length: 40 }, (_, i) => ({
    complete: true,
    time: new Date(now - (40 - i) * 900000).toISOString(),
    mid: { o: "1.08", h: "1.081", l: "1.079", c: "1.08" },
  }));
  let orders = 0;
  const client = {
    token: "practice",
    accountId: "101-001",
    liveHost: false,
    async getAccount() {
      return { account: { id: "101-001", currency: "USD", balance: "5000", NAV: "5015", lastTransactionID: "1" } };
    },
    async getPrices() {
      return {
        prices: FOREX_SPEC.scanInstruments.map((instrument) => ({
          instrument,
          time: new Date(now - 500).toISOString(),
          bids: [{ price: "1.08340" }],
          asks: [{ price: "1.08350" }],
        })),
      };
    },
    async getCandles() {
      return { candles: bars };
    },
    async createMarketOrder() {
      orders += 1;
      throw new Error("strategies must not call the broker");
    },
  };
  const snapshot = await runForexEngineCycle({ client, forexAutoEnabled: true, now, durableStorageAvailable: false });
  assert.equal(orders, 0);
  assert.equal(snapshot.executionReady, false);
  assert.ok(Array.isArray(snapshot.signals));
});

test("stock autopilot source still does not wrap the forex cycle", () => {
  const engineCycleSource = fs.readFileSync(new URL("../engine/createEngineCycle.js", import.meta.url), "utf8");
  const autoBlock = engineCycleSource.slice(
    engineCycleSource.lastIndexOf("if (autoTradingEnabled && !engineState.dailyLossLocked)"),
    engineCycleSource.lastIndexOf("if (typeof runForexEngineCycle")
  );
  assert.doesNotMatch(autoBlock, /runForexEngineCycle/);
});

test("position size floors units and never rounds through the risk limit", () => {
  assert.equal(permittedUnits({
    allowedRisk: 12.50,
    worstEntry: 1.1000,
    stop: 1.0980,
    costAllowance: 0.0001,
  }), 5952);
  assert.equal(permittedUnits({
    allowedRisk: 12.50,
    worstEntry: 1.1000,
    stop: 1.0980,
    costAllowance: 0.0001,
    instrument: { minimumTradeSize: 10000 },
  }), 0);
});

test("missing calendar coverage blocks automatic entries", () => {
  assert.equal(calendarAllowsEntry({ coverageComplete: false }).reason, "CALENDAR_UNAVAILABLE");
  assert.equal(calendarAllowsEntry({
    coverageComplete: true,
    refreshedAt: new Date().toISOString(),
  }).ok, true);
});

test("breakout strategy is a pure function of the snapshot", () => {
  const h1 = Array.from({ length: 30 }, (_, i) => candle(1.2, { h: 1.201, l: 1.199, t: String(i) }));
  const first = evaluateBreakoutRetest({ h1, m15: h1.slice(-8), h4: [], side: "buy" });
  const second = evaluateBreakoutRetest({ h1, m15: h1.slice(-8), h4: [], side: "buy" });
  assert.deepEqual(first.status, second.status);
  assert.deepEqual(first.reason, second.reason);
});

test("candle gaps duplicates and order are detected", async () => {
  const { inspectCandles } = await import("../forex/candleIntegrity.js");
  const gap = inspectCandles([
    { t: "2026-09-22T10:00:00.000Z", complete: true },
    { t: "2026-09-22T12:00:00.000Z", complete: true },
  ], "H1");
  assert.equal(gap.ok, false);
  assert.ok(gap.issues.includes("CANDLE_GAP"));
  const dup = inspectCandles([
    { t: "2026-09-22T10:00:00.000Z", complete: true },
    { t: "2026-09-22T10:00:00.000Z", complete: true },
  ], "H1");
  assert.ok(dup.issues.includes("CANDLE_DUPLICATE"));
});

test("replay never sees later candles", async () => {
  const { candlesKnownAt } = await import("../forex/replay.js");
  const rows = [
    { t: "2026-09-22T10:00:00.000Z", complete: true, c: 1 },
    { t: "2026-09-22T11:00:00.000Z", complete: true, c: 2 },
  ];
  assert.equal(candlesKnownAt(rows, "2026-09-22T10:30:00.000Z").length, 1);
});

test("evaluation gate refuses promotion without evidence", async () => {
  const { promoteStrategy, createApprovalRegistry } = await import("../forex/approvalRegistry.js");
  const registry = createApprovalRegistry();
  const result = promoteStrategy(registry, "FOREX_BREAKOUT_RETEST_V1", { completedTrades: 10 });
  assert.equal(result.ok, false);
  assert.equal(registry.FOREX_BREAKOUT_RETEST_V1.permittedEnvironment, "RESEARCH");
});

test("durable store commits intent and reservation together", async () => {
  const { createMemoryStore } = await import("../forex/durableStore.js");
  const store = createMemoryStore({ treatAsDurable: true });
  await store.commit((ledger) => {
    ledger.intents.push({ intentId: "a" });
    ledger.reservations.push({ intentId: "a" });
  });
  const loaded = await store.load();
  assert.equal(loaded.intents.length, 1);
  assert.equal(loaded.reservations.length, 1);
});

test("unknown order outcome keeps reservation and does not retry", async () => {
  const { createMemoryStore } = await import("../forex/durableStore.js");
  const { createExecutionCoordinator } = await import("../forex/executionCoordinator.js");
  const { createApprovalRegistry } = await import("../forex/approvalRegistry.js");
  const store = createMemoryStore({ treatAsDurable: true });
  const coordinator = createExecutionCoordinator({
    // Unit test isolates broker timeout handling; real evidence refresh has dedicated integration tests.
    refreshPlan: async (_adapter, _store, plan) => ({ ...plan, conversionFactor: 1 }),
    adapter: {
      liveHost: false,
      async createMarketOrder() {
        const error = new Error("timeout");
        error.halt = "UNCERTAIN_ORDER";
        throw error;
      },
    },
    registry: createApprovalRegistry({
      FOREX_BREAKOUT_RETEST_V1: { permittedEnvironment: "FORWARD_PRACTICE" },
    }),
    store,
    instanceId: "t1",
  });
  const result = await coordinator.submit({
    intent: "automatic",
    executionReady: true,
    autoTradingAuthorized: true,
    strategyId: "FOREX_BREAKOUT_RETEST_V1",
    environment: "FORWARD_PRACTICE",
    accountId: "101",
    instrumentId: "EUR_USD",
    units: -1000,
    currentUnits: 0,
    priceBound: "1.08",
    stopLossOnFill: "1.09",
    takeProfitOnFill: "1.12",
    worstEntryPrice: 1.0835,
    stop: 1.09,
    bid: 1.0834,
    ask: 1.0835,
    A: 0.01,
    allowedRisk: 12.5,
    remainingDailyRisk: 1,
    plannedRiskPercent: 0.25,
    openPlusPendingPercent: 0,
    sameDirectionPercent: 0,
    quoteOk: true,
    calendar: { coverageComplete: true, refreshedAt: new Date().toISOString(), events: [] },
    marginAvailable: 4000,
    requiredMargin: 10,
    instrument: { minimumTradeSize: 1 },
    clientRequestId: "once",
  });
  assert.equal(result.state, "OUTCOME_UNKNOWN");
  assert.equal(result.keepReservation, true);
  const ledger = await store.load();
  assert.equal(ledger.reservations.length, 1);
  const second = await coordinator.submit({
    intent: "automatic",
    executionReady: true,
    autoTradingAuthorized: true,
    strategyId: "FOREX_BREAKOUT_RETEST_V1",
    environment: "FORWARD_PRACTICE",
    clientRequestId: "once",
    quoteOk: true,
    calendar: { coverageComplete: true, refreshedAt: new Date().toISOString(), events: [] },
  });
  assert.equal(second.reason, "DUPLICATE_INTENT");
});

test("reduce-only close cannot open an opposite position", async () => {
  const { createMemoryStore } = await import("../forex/durableStore.js");
  const { createExecutionCoordinator } = await import("../forex/executionCoordinator.js");
  const store = createMemoryStore({ treatAsDurable: true });
  const coordinator = createExecutionCoordinator({
    adapter: { liveHost: false, async createMarketOrder() { throw new Error("no"); },
      async getOpenTrades() { return { trades: [{ id: "t1", instrument: "EUR_USD", currentUnits: "1000" }] }; } },
    registry: createApprovalRegistry(),
    store,
  });
  const result = await coordinator.submit({
    intent: "close",
    positionFill: "REDUCE_ONLY",
    brokerTradeId: "t1",
    executionReady: true,
    units: -2000,
    currentUnits: 1000,
    accountId: "101",
    instrumentId: "EUR_USD",
  });
  assert.equal(result.reason, "CLOSE_WOULD_OPEN");
});

test("empty calendar is not treated as no news", async () => {
  const { calendarForDecision } = await import("../forex/calendarFeed.js");
  assert.equal(calendarForDecision({ coverageComplete: false, events: [] }).reason, "CALENDAR_UNAVAILABLE");
});
