import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runCanonicalForexPipeline } from "../forex/platformPipeline.js";
import { createForexSqliteJournal } from "../forex/sqliteJournal.js";
import { verifyEvidenceSnapshot } from "../forex/evidenceSnapshot.js";
import { createExecutionCoordinator } from "../forex/executionCoordinator.js";
import { createMemoryStore } from "../forex/durableStore.js";
import { createApprovalRegistry } from "../forex/approvalRegistry.js";
import { createForexProviderContextService } from "../forex/providerContextService.js";

const at = Date.parse("2026-09-23T14:00:30Z");
const iso = value => new Date(value).toISOString();
const rows = (count, period, start = 1.08) => Array.from({ length: count }, (_, index) => {
  const close = start + index * 0.0002 + Math.sin(index / 2) * 0.00005;
  return {
    t: iso(at - (count - index) * period),
    o: close - 0.00005,
    h: close + 0.0002,
    l: close - 0.0002,
    c: close,
    complete: true,
  };
});

const provider = (name, observations = []) => ({
  state: "FRESH",
  ageMs: 1000,
  observations,
  provenance: {
    provider: name,
    sourceUrl: `https://${name.toLowerCase()}.test`,
    observedAt: iso(at),
    publishedAt: iso(at - 1000),
    vintageAt: null,
  },
  error: null,
});

test("canonical evidence-to-fill chain separates score, calibrated probability, EV and authority", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "forex-platform-"));
  const journal = createForexSqliteJournal({
    filePath: path.join(directory, "journal.sqlite"),
    persistentRoot: directory,
  });
  t.after(() => {
    journal.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const bucket = "FOREX_BREAKOUT_RETEST_V1:trend:london+newYork:BUY";
  for (let index = 0; index < 20; index += 1) {
    journal.append({
      type: "OUTCOME",
      occurredAt: iso(at - (index + 1) * 86400000),
      entityId: "EUR_USD",
      payload: {
        bucket,
        strategyId: "FOREX_BREAKOUT_RETEST_V1",
        success: index < 14,
        rMultiple: index < 14 ? 1.4 : -1,
        resolvedAt: iso(at - (index + 1) * 86400000),
      },
    });
  }
  const quote = {
    bid: 1.1,
    ask: 1.1001,
    bidSize: 100000,
    askSize: 100000,
    spreadR: 0.04,
    time: iso(at),
  };
  const pipeline = runCanonicalForexPipeline({
    instrument: "EUR_USD",
    side: "BUY",
    asOf: at,
    quote,
    bars: {
      daily: rows(40, 86400000),
      h4: rows(50, 14400000),
      h1: rows(60, 3600000),
      m15: rows(80, 900000),
      m5: rows(120, 300000),
    },
    pairReturns: [
      { pair: "EUR_USD", return: 0.01 }, { pair: "GBP_USD", return: 0.005 },
      { pair: "USD_JPY", return: 0.004 }, { pair: "USD_CHF", return: 0.003 },
      { pair: "AUD_USD", return: 0.002 }, { pair: "NZD_USD", return: 0.001 },
      { pair: "USD_CAD", return: 0.002 },
    ],
    providerContext: {
      providers: {
        fred: provider("FRED"), cftc: provider("CFTC"),
        cme: provider("CME"), finnhub: provider("FINNHUB"),
      },
      rates: { yields: { EUR: 3, USD: 2 }, expectedChanges: { EUR: 0, USD: -0.25 } },
      macroEvents: [],
      executionCosts: { EUR_USD: { slippageR: 0.02, financingR: 0.01 } },
    },
    allowedPairs: ["EUR_USD"],
    strategyId: "FOREX_BREAKOUT_RETEST_V1",
    strategyApproved: true,
    calendarClear: true,
    spreadAcceptable: true,
    intendedSize: 1000,
    portfolioRisk: {
      openRisk: 0, pendingRisk: 0, proposedRisk: 5, accountRiskCap: 20,
      strategyId: "FOREX_BREAKOUT_RETEST_V1", strategyRisk: 0, strategyRiskCap: 10,
      currencySameDirectionRisk: 0, currencyRiskCap: 15,
      openPositionCount: 0, correlationEvidence: [], correlationRiskCap: 20,
      weeklyLossFraction: 0, weeklyLossLimit: 0.04, drawdownFraction: 0,
    },
    calibration: {
      outOfSample: true,
      points: [{ predicted: 0, observed: 0 }, { predicted: 1, observed: 1 }],
    },
    measuredSlippageR: 0.02,
    financingR: 0.01,
    rewardR: 2.2,
    journal,
    configHash: "fixture-config",
  });
  assert.equal(verifyEvidenceSnapshot(pipeline.evidence), true);
  assert.equal(pipeline.opportunityScore.meaning, "RANKING_ONLY_NOT_PROBABILITY");
  assert.equal(pipeline.probability.calibrationApplied, true);
  assert.ok(pipeline.expectedValue.expectedValue > 0);
  assert.equal(pipeline.decision.action, "BUY");
  assert.match(pipeline.evidenceSnapshotId, /^fxs-/);

  let orders = 0;
  const adapter = {
    liveHost: false,
    async createMarketOrder(input) {
      orders += 1;
      return {
        orderCreateTransaction: { id: "broker-order" },
        orderFillTransaction: {
          id: "fill-1", type: "ORDER_FILL", orderID: "broker-order",
          instrument: input.instrument, units: String(input.units), price: "1.10011",
          time: iso(at), tradeOpened: { tradeID: "trade-1", units: String(input.units), price: "1.10011" },
        },
      };
    },
  };
  const store = createMemoryStore({ treatAsDurable: true });
  const registry = createApprovalRegistry({
    FOREX_BREAKOUT_RETEST_V1: { permittedEnvironment: "FORWARD_PRACTICE" },
  });
  const coordinator = createExecutionCoordinator({
    adapter, store, registry, journal, refreshPlan: async (_adapter, _store, plan) => plan,
    getAutoEnabled: () => true, nowFn: () => at,
  });
  const fill = await coordinator.submit({
    intent: "automatic", environment: "FORWARD_PRACTICE", practiceOrdersEnabled: true,
    executionReady: true, autoTradingAuthorized: true,
    strategyId: "FOREX_BREAKOUT_RETEST_V1", comparableBucket: bucket,
    predictedProbability: pipeline.probability.probability,
    accountId: "practice", instrumentId: "EUR_USD", candidateId: "candidate-1",
    evidenceSnapshotId: pipeline.evidenceSnapshotId, configHash: "fixture-config",
    units: 1000, currentUnits: 0, openOnInstrument: false,
    worstEntryPrice: 1.1001, stop: 1.098, A: 0.002,
    bid: 1.1, ask: 1.1001, priceBound: "1.1002",
    stopLossOnFill: "1.098", takeProfitOnFill: "1.10472",
    allowedRisk: 5, conversionFactor: 1, instrument: {
      minimumTradeSize: 1, tradeUnitsPrecision: 0, absoluteSpreadLimit: 0.0001,
    },
    remainingDailyRisk: 2, remainingWeeklyRisk: 4, plannedRiskPercent: 0.5,
    openPlusPendingPercent: 0, sameDirectionPercent: 0, drawdownPercent: 0,
    quoteOk: true, calendar: { coverageComplete: true, refreshedAt: iso(at), events: [] },
    now: at, marginAvailable: 1000, requiredMargin: 25,
    clientRequestId: "e2e-request",
  });
  assert.equal(fill.state, "FILLED");
  assert.equal(orders, 1);
  assert.ok(Number.isFinite(fill.measuredSlippage));
  assert.equal(journal.listEvents({ type: "ORDER_INTENT" }).length, 1);
  assert.equal(journal.listEvents({ type: "FILL" }).length, 1);

  const missingCost = runCanonicalForexPipeline({
    instrument: "EUR_USD", side: "BUY", asOf: at, quote,
    bars: { daily: rows(40, 86400000), h4: rows(50, 14400000), h1: rows(60, 3600000), m15: rows(80, 900000), m5: rows(120, 300000) },
    pairReturns: [], providerContext: {}, allowedPairs: ["EUR_USD"],
    strategyId: "FOREX_BREAKOUT_RETEST_V1", strategyApproved: true,
    calendarClear: true, spreadAcceptable: true, intendedSize: 1000,
    portfolioRisk: {
      openRisk: 0, pendingRisk: 0, proposedRisk: 5, accountRiskCap: 20,
      strategyId: "FOREX_BREAKOUT_RETEST_V1", strategyRisk: 0, strategyRiskCap: 10,
      currencySameDirectionRisk: 0, currencyRiskCap: 15, openPositionCount: 0,
      weeklyLossFraction: 0, weeklyLossLimit: 0.04, drawdownFraction: 0,
    },
    journal, persistSnapshot: false, rewardR: 2.2,
  });
  assert.equal(missingCost.expectedValue.expectedValue, null);
  assert.equal(missingCost.decision.action, "WAIT");
});

test("provider context refresh preserves official evidence and explicit unavailable forward expectations", async () => {
  const observation = (name, values) => async () => provider(name, values);
  const service = createForexProviderContextService({
    now: () => at,
    rateSeries: { EUR: "EUR_RATE", USD: "USD_RATE" },
    fred: { observations: async series => provider("FRED", [{ seriesId: series, date: "2026-09-23", value: series === "EUR_RATE" ? 3 : 2 }]) },
    cftc: { observations: observation("CFTC", [{ market: "EURO FX", leveragedFundsLong: 20, leveragedFundsShort: 10 }]) },
    cme: { observations: observation("CME", []) },
    finnhub: { observations: observation("FINNHUB", [{ event: "CPI", currency: "USD", actual: 2, estimate: 1, timestamp: iso(at) }]) },
  });
  const context = await service.refresh();
  assert.deepEqual(context.rates.yields, { EUR: 3, USD: 2 });
  assert.deepEqual(context.rates.expectedChanges, {});
  assert.equal(context.providers.cftc.provenance.provider, "CFTC");
  assert.equal(context.macroEvents[0].actual, 2);
});
