import test from "node:test";
import assert from "node:assert/strict";
import {
  collectNewsWatchSymbols,
  isStockWatchlistEligible,
  passesWatchMoverActivity,
  WATCH_DISCOVERY_DEFAULTS,
} from "../discovery/watchOnlyDiscovery.js";
import { DEFAULT_DISCOVERY_BUDGETS } from "../discovery/quietDiscoveryPipeline.js";
import { evaluateStockTradeCandidate, STOCK_EXECUTION_THRESHOLDS } from "../scoring/decisionScores.js";
import { manualResetDailyLossLock } from "../state/dailySafetyState.js";
import { RESET_DAILY_LOSS_CONFIRMATION, registerOperationalControlRoutes } from "../routes/operationalControlRoutes.js";

test("quiet watch discovery is looser than buy gates", () => {
  assert.equal(WATCH_DISCOVERY_DEFAULTS.maxCurrentMovePercent, 10);
  assert.equal(WATCH_DISCOVERY_DEFAULTS.minAverageDollarVolume, 100000);
  assert.equal(DEFAULT_DISCOVERY_BUDGETS.maxCurrentMovePercent, 10);
  assert.equal(DEFAULT_DISCOVERY_BUDGETS.minAverageDollarVolume, 100000);
  assert.equal(STOCK_EXECUTION_THRESHOLDS.finalScore, 70);
  assert.equal(STOCK_EXECUTION_THRESHOLDS.entryScore, 75);
  assert.equal(STOCK_EXECUTION_THRESHOLDS.maxQuoteAgeSeconds, 5);
  assert.equal(STOCK_EXECUTION_THRESHOLDS.maxSpreadPercent, 1);
});

test("regular-session watch movers can enter before 300k volume or 5x RVOL", () => {
  assert.equal(passesWatchMoverActivity({ percentChange: 2.5, volume: 60000 }, { marketOpen: true }), true);
  assert.equal(passesWatchMoverActivity({ percentChange: 0.1, volume: 20000 }, { marketOpen: true }), false);
  assert.equal(passesWatchMoverActivity({ percentChange: 6, volume: 80000 }, { marketOpen: true }), true);
});

test("incomplete entry coverage can still be watch-only and is not buyable", () => {
  assert.equal(isStockWatchlistEligible({ finalScore: 42, discoveryAvailable: true }), true);
  assert.equal(isStockWatchlistEligible({ finalScore: 61, discoveryAvailable: false }), true);
  assert.equal(isStockWatchlistEligible({ finalScore: 40, discoveryAvailable: false }), false);
  const watch = evaluateStockTradeCandidate({
    masterFinalScore: 48,
    entryQualityScore: 20,
    entryQualityScorecard: { approved: false, coverage: 0.2 },
    discoveryScorecard: { coverage: 0.7 },
    decisionScoreCoverage: 0.3,
  });
  assert.equal(watch.watchlistEligible, true);
  assert.equal(watch.approved, false);
  assert.ok(watch.reasons.includes("FINAL_SCORE_BELOW_70"));
});

test("recent headline symbols become watch-only names", () => {
  const now = Date.parse("2026-09-22T14:00:00.000Z");
  const symbols = collectNewsWatchSymbols([
    { related: "JAGX,AAPL", publishedAt: now - 30 * 60 * 1000 },
    { symbol: "MARKET", publishedAt: now - 10 * 60 * 1000 },
    { related: "OLD", publishedAt: now - 10 * 60 * 60 * 1000 },
  ], { now });
  assert.deepEqual(symbols, ["JAGX", "AAPL"]);
});

test("daily loss reset unlocks and rebases equity without touching profit lock", () => {
  const state = {
    dailyLossLocked: true,
    profitLocked: true,
    dailyStartEquity: 100000,
    dailyPeakEquity: 100000,
    dailyDateKey: "2026-09-21",
  };
  manualResetDailyLossLock(state, { equity: 97500, todayKey: "2026-09-22" });
  assert.equal(state.dailyLossLocked, false);
  assert.equal(state.profitLocked, true);
  assert.equal(state.dailyStartEquity, 97500);
  assert.equal(state.dailyPeakEquity, 97500);
  assert.equal(state.dailyDateKey, "2026-09-22");
});

test("daily loss reset route requires the confirmation phrase and does not arm autopilot", async () => {
  const routes = {};
  const app = {
    post(path, _auth, handler) {
      routes[path] = handler;
    },
  };
  let saved = false;
  registerOperationalControlRoutes(app, {
    requireAdmin: (_req, _res, next) => next(),
    getControlState: () => ({
      emergencyStopActive: true,
      autoTradingEnabled: false,
      dailyLossLocked: false,
    }),
    updateControlState: () => ({ emergencyStopActive: true, autoTradingEnabled: false }),
    resetDailyLossLock: () => ({ dailyLossLocked: false, dailyStartEquity: 98000 }),
    recordOrder: () => {},
    getClientIp: () => "127.0.0.1",
    saveEngineState: () => { saved = true; },
  });
  const denied = await new Promise((resolve) => {
    routes["/daily-loss-lock/reset"]({ body: { confirmation: "yes" } }, {
      status: (code) => ({ json: (body) => resolve({ code, body }) }),
      json: (body) => resolve({ code: 200, body }),
    });
  });
  assert.equal(denied.code, 400);
  const allowed = await new Promise((resolve) => {
    routes["/daily-loss-lock/reset"]({ body: { confirmation: RESET_DAILY_LOSS_CONFIRMATION } }, {
      status: (code) => ({ json: (body) => resolve({ code, body }) }),
      json: (body) => resolve({ code: 200, body }),
    });
  });
  assert.equal(allowed.code, 200);
  assert.equal(allowed.body.ok, true);
  assert.equal(allowed.body.autoTradingEnabled, false);
  assert.equal(allowed.body.emergencyStopActive, true);
  assert.equal(saved, true);
});
