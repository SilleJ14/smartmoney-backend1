import test from "node:test";
import assert from "node:assert/strict";
import { registerStatusRoutes } from "../routes/statusRoutes.js";

test("lightweight status carries the frontend trading and discovery contract", async () => {
  const routes = new Map();
  const app = {
    get: (path, ...handlers) => routes.set(path, handlers.at(-1)),
  };
  const state = {
    marketOpen: true,
    dailyLossLocked: false,
    profitLocked: false,
    lastScanAt: "2026-08-27T14:00:00.000Z",
    liveStarterBuyGateState: { topApproved: [{ symbol: "AAPL" }] },
    quietCandidateOutcomeState: { observationCount: 4 },
    quietCandidateOutcomeLearning: { stock: { sampleCount: 2 } },
    boundedQuietDiscoveryState: { watchlistCount: 10 },
    forexEngine: { lastCycleAt: "current", positions: [] },
    forexProtection: { positionsChecked: 0 },
  };
  registerStatusRoutes(app, {
    requireAdmin: (_req, _res, next) => next(),
    getState: () => state,
    getRuntime: () => ({
      mode: "live_stock",
      tradingModeLocked: false,
      autoTradingEnabled: true,
      emergencyStopActive: false,
      forexAutoEnabled: false,
      forexEmergencyStopActive: true,
      forexPauseEntries: true,
      forexCalendarStatus: { qualityStatus: 'ERROR', error: 'CALENDAR_ACCESS_DENIED' },
      config: { minScoreToBuy: 78 },
    }),
    refreshAccountCache: async () => { throw new Error("simulated Alpaca outage"); },
    getLatestStatus: () => ({
      signalCount: 1,
      forexEngine: { lastCycleAt: "old" },
      stockSignalCount: 1,
      cryptoSignalCount: 0,
      topStockSignals: [{ symbol: "AAPL" }],
      topCryptoSignals: [],
      account: { equity: 1000, cash: 900 },
      risk: { currentEquity: 1000 },
      institutionalDashboard: { marketRegime: { label: "BULLISH" } },
    }),
    mergeLiveQuote: (value) => value,
    summarizeQuietCandidateOutcomes: (outcomes, options) => ({
      observationCount: outcomes.observationCount,
      watched: options.stockDiscoveryState.watchlistCount,
    }),
    getAccount: async () => ({}),
    updateAccountPeaks: () => ({}),
    getClock: async () => ({}),
    getPositions: async () => [],
    getBotOwnedSymbols: async () => [],
    getOpenOrders: async () => [],
    reconcileBrokerState: () => ({ pendingExits: [] }),
    normalizeSymbol: (value) => value,
    isManagedPosition: () => false,
    getBotExposure: () => 0,
    buildInstitutionalDashboard: () => ({}),
    buildHighConvictionSummary: () => ({}),
    buildTopBrains: () => [],
  });
  const response = {
    json(value) { this.body = value; },
    status(code) { this.statusCode = code; return this; },
  };
  await routes.get("/status")({}, response);

  assert.equal(response.body.ok, true);
  assert.equal(response.body.forexEmergencyStopActive, true);
  assert.equal(response.body.forexPauseEntries, true);
  assert.equal(response.body.forexCalendar.error, 'CALENDAR_ACCESS_DENIED');
  assert.equal(response.body.forexEngine.lastCycleAt, "current");
  assert.equal(response.body.forexProtection.positionsChecked, 0);
  assert.equal(response.body.statusAccountRefresh.stale, true);
  assert.equal(response.body.config.minScoreToBuy, 78);
  assert.equal(response.body.engineState.marketOpen, true);
  assert.equal(response.body.engineState.liveStarterBuyGateState.topApproved[0].symbol, "AAPL");
  assert.equal(response.body.institutionalDashboard.marketRegime.label, "BULLISH");
  assert.equal(response.body.quietDiscoveryProof.observationCount, 4);
  assert.equal(response.body.quietDiscoveryProof.watched, 10);
});
