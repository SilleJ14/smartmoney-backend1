import test from "node:test";
import assert from "node:assert/strict";
import { buildTelemetry, registerDiagnosticRoutes } from "../routes/diagnosticRoutes.js";

test("diagnostic telemetry bounds heavy histories", () => {
  const state = {
    institutionalWatchlist: Array.from({ length: 100 }, (_, index) => ({ symbol: `S${index}` })),
    analyticsSnapshots: Array.from({ length: 100 }, (_, index) => index),
    statisticalMemoryState: {
      setupHistory: Array.from({ length: 100 }, (_, index) => index),
      setupPerformance: Object.fromEntries(Array.from({ length: 100 }, (_, index) => [`S${index}`, index])),
      expectancyHistory: Array.from({ length: 100 }, (_, index) => index),
      probabilityHistory: Array.from({ length: 100 }, (_, index) => index),
    },
    boundedQuietDiscoveryState: {
      watchlist: Array.from({ length: 100 }, (_, index) => ({ symbol: `Q${index}` })),
      liveSymbols: Array.from({ length: 100 }, (_, index) => `Q${index}`),
    },
  };
  const telemetry = buildTelemetry(state, {});

  assert.equal(telemetry.institutionalWatchlist.length, 30);
  assert.equal(telemetry.analyticsSnapshots.length, 20);
  assert.equal(telemetry.statisticalMemoryState.setupHistory.length, 20);
  assert.equal(Object.keys(telemetry.statisticalMemoryState.setupPerformance).length, 30);
  assert.equal(telemetry.boundedQuietDiscovery.watchlist.length, 20);
});

test("debug route returns a bounded engine summary instead of the full engine graph", async () => {
  const routes = new Map();
  const app = {
    get: (path, ...handlers) => routes.set(path, handlers.at(-1)),
  };
  const state = {
    lastSignals: [],
    skippedSymbols: [],
    liveQuoteCache: { HUGE: { rawPayload: "x".repeat(10_000) } },
  };
  registerDiagnosticRoutes(app, {
    requireAdmin: (_req, _res, next) => next(),
    getState: () => state,
    getConfig: () => ({ maxBotExposurePercent: 15, maxOpenTrades: 8 }),
    getAccount: async () => ({ status: "ACTIVE", equity: 1000, cash: 900 }),
    getClock: async () => ({ is_open: true }),
    getTopMovers: async () => ["AAA"],
    getPositions: async () => [],
    getBotOwnedSymbols: async () => [],
    isManagedPosition: () => false,
    getBotExposure: () => 0,
    getMaxSymbols: () => 50,
    getFreshness: () => ({}),
  });
  const response = {
    json(value) { this.body = value; },
    status(code) { this.statusCode = code; return this; },
  };
  await routes.get("/debug")({}, response);

  assert.equal(response.body.ok, true);
  assert.equal(response.body.engineState, undefined);
  assert.ok(response.body.engineSummary);
  assert.equal(JSON.stringify(response.body).includes("rawPayload"), false);
});
