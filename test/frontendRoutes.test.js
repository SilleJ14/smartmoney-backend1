import test from "node:test";
import assert from "node:assert/strict";
import { registerFrontendRoutes } from "../routes/frontendRoutes.js";

function createHarness(overrides = {}) {
  const routes = new Map();
  const app = {
    get: (path, _middleware, handler) => routes.set(`GET ${path}`, handler),
  };
  registerFrontendRoutes(app, {
    requireAdmin: (_req, _res, next) => next(),
    getState: () => ({}),
    getConfig: () => ({}),
    refreshAccountCache: async () => {},
    getLatestStatus: () => ({}),
    buildStartupSnapshot: () => ({}),
    normalizeSymbol: (value) => String(value || "").trim().toUpperCase(),
    mergeLiveQuote: (signal) => signal,
    getTopSignals: (signals) => signals,
    getMarketNewsFeed: async () => ({ available: false, articles: [] }),
    ...overrides,
  });

  const invoke = async (path) => {
    const response = { statusCode: 200, body: null };
    response.status = (code) => {
      response.statusCode = code;
      return response;
    };
    response.json = (payload) => {
      response.body = payload;
      return response;
    };
    await routes.get(`GET ${path}`)({ query: {} }, response);
    return response;
  };

  return { invoke };
}

test("frontend AI feed includes independent market news when no signal candidates exist", async () => {
  const api = createHarness({
    getMarketNewsFeed: async () => ({
      available: true,
      stale: false,
      reason: "Live market news",
      fetchedAt: "2026-08-30T14:00:00.000Z",
      articles: [
        {
          symbol: "AAPL",
          headline: "Apple announces a new product update",
          source: "Example Wire",
          publishedAt: 1788098400000,
        },
      ],
    }),
  });

  const response = await api.invoke("/frontend/ai");

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.ai.newsFeed.length, 1);
  assert.equal(response.body.ai.newsFeed[0].symbol, "AAPL");
  assert.equal(response.body.ai.newsFeed[0].headline, "Apple announces a new product update");
  assert.deepEqual(response.body.ai.newsFeedStatus, {
    available: true,
    stale: false,
    reason: "Live market news",
    fetchedAt: "2026-08-30T14:00:00.000Z",
  });
});

test("frontend AI route stays available when the independent news provider fails", async () => {
  const api = createHarness({
    getMarketNewsFeed: async () => {
      throw new Error("provider timeout");
    },
  });

  const response = await api.invoke("/frontend/ai");

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.success, true);
  assert.deepEqual(response.body.ai.newsFeed, []);
  assert.equal(response.body.ai.newsFeedStatus.available, false);
  assert.equal(response.body.ai.newsFeedStatus.reason, "provider timeout");
});

test("frontend signals require all approval flags and rank by canonical F", async () => {
  const approval = {
    qualifiedToBuy: true,
    autoTradeApproved: true,
    approved: true,
    backendApproved: true,
  };
  const api = createHarness({
    getState: () => ({
      topStockSignals: [
        { symbol: "AAPL", score: 5, masterFinalScore: 81, stockDecisionScoreAvailable: true, ...approval },
        { symbol: "LOOSE", score: 100, masterFinalScore: 99, stockDecisionScoreAvailable: true, qualifiedToBuy: true, autoTradeApproved: true },
      ],
      topCryptoSignals: [
        { symbol: "BTC/USD", score: 99, cryptoDecisionScore: 72, cryptoDecisionScoreAvailable: true, ...approval },
      ],
    }),
  });

  const response = await api.invoke("/frontend/signals");

  assert.equal(response.body.approvedCount, 2);
  assert.deepEqual(response.body.signals.map((signal) => signal.symbol), ["AAPL", "BTC/USD"]);
});

test("frontend alerts expose canonical F and never report loose approval", async () => {
  const api = createHarness({
    getConfig: () => ({ minScoreToBuy: 70 }),
    getState: () => ({
      topStockSignals: [
        {
          symbol: "AAPL",
          score: 10,
          masterFinalScore: 80,
          stockDecisionScoreAvailable: true,
          qualifiedToBuy: true,
          autoTradeApproved: true,
          approved: true,
          backendApproved: true,
        },
        { symbol: "LEGACY", score: 100, qualifiedToBuy: true, autoTradeApproved: true },
      ],
    }),
  });

  const response = await api.invoke("/frontend/alerts");

  assert.equal(response.body.count, 1);
  assert.equal(response.body.alerts[0].symbol, "AAPL");
  assert.equal(response.body.alerts[0].score, 80);
  assert.equal(response.body.alerts[0].approved, true);
});
