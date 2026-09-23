import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { FOREX_SPEC, pipSize } from "../forex/forexSpec.js";
import { runForexEngineCycle } from "../forex/forexEngine.js";
import { createOandaClient } from "../forex/oandaClient.js";

function candle(c, { t = "2026-09-22T14:00:00.000Z" } = {}) {
  return { t, o: c, h: c + 0.0002, l: c - 0.0002, c, complete: true };
}

function flatRange(count, price = 1.1) {
  return Array.from({ length: count }, (_, index) => candle(price, {
    t: new Date(Date.parse("2026-09-22T00:00:00.000Z") + index * 15 * 60 * 1000).toISOString(),
  }));
}

test("frozen forex spec does not share stock F or Alpaca auto", () => {
  assert.equal(FOREX_SPEC.version, "fx-v1");
  assert.equal(FOREX_SPEC.quoteProviderMaxAgeSeconds, 2);
  assert.equal(FOREX_SPEC.liveOrdersAuthorized, false);
  assert.equal(pipSize("USD_JPY"), 0.01);
  assert.equal(pipSize("EUR_USD"), 0.0001);
});

test("missing OANDA credentials halt the forex engine without touching Autopilot", async () => {
  const snapshot = await runForexEngineCycle({
    client: { token: "", accountId: "", liveHost: false },
    forexAutoEnabled: true,
  });
  assert.equal(snapshot.halt, "MISSING_CREDENTIALS");
  assert.equal(snapshot.forexAutoEnabled, true);
  assert.equal(snapshot.executionReady, false);
  assert.equal(snapshot.signals.length, 0);
});

test("live OANDA host cannot place forex orders", async () => {
  const client = createOandaClient({
    accountId: "x",
    token: "y",
    baseUrl: "https://api-fxtrade.oanda.com",
  });
  assert.equal(client.liveHost, true);
  await assert.rejects(() => client.createMarketOrder({
    instrument: "EUR_USD",
    units: 1,
    priceBound: "1.1",
    stopLossPrice: "1.09",
  }), /LIVE_FOREX/);
});

test("practice cycle can scan when the client returns account prices and candles", async () => {
  const now = Date.parse("2026-09-22T18:00:00.000Z");
  const candles = flatRange(40, 1.08345).map((row) => ({
    complete: true,
    time: row.t,
    mid: { o: String(row.o), h: String(row.h), l: String(row.l), c: String(row.c) },
  }));
  const client = {
    token: "practice",
    accountId: "101-001",
    liveHost: false,
    async getAccount() {
      return { account: { id: "101-001", currency: "USD", balance: "5000", NAV: "5015", unrealizedPL: "15", marginUsed: "80", marginAvailable: "4920", openTradeCount: "0" } };
    },
    async getTransactionsSince() { return { transactions: [] }; },
    async getOpenTrades() { return { trades: [] }; },
    async getPrices() {
      return {
        prices: FOREX_SPEC.scanInstruments.map((instrument) => ({
          instrument,
          time: new Date(now - 1000).toISOString(),
          bids: [{ price: "1.08340" }],
          asks: [{ price: "1.08350" }],
          tradeable: true,
        })),
      };
    },
    async getCandles() {
      return { candles };
    },
    async createMarketOrder() {
      throw new Error("should not order while halt or no ready setup");
    },
  };
  const snapshot = await runForexEngineCycle({ client, forexAutoEnabled: false, now });
  assert.equal(snapshot.halt, "CLEAR");
  assert.equal(snapshot.account.NAV, 5015);
  assert.equal(snapshot.signals.length, FOREX_SPEC.scanInstruments.length);
  assert.equal(snapshot.signals[0].assetClass, "forex");
  assert.equal(snapshot.executionReady, false);
  assert.ok(snapshot.quoteAgeSeconds <= 2);
});

test("forex engine cycle is independent of stock Autopilot in source", () => {
  const engineCycleSource = fs.readFileSync(new URL("../engine/createEngineCycle.js", import.meta.url), "utf8");
  const autoBlock = engineCycleSource.slice(
    engineCycleSource.lastIndexOf("if (autoTradingEnabled && !engineState.dailyLossLocked)"),
    engineCycleSource.lastIndexOf("if (typeof runForexEngineCycle")
  );
  assert.doesNotMatch(autoBlock, /runForexEngineCycle/);
  assert.match(engineCycleSource, /runForexEngineCycle/);
  const serverSource = fs.readFileSync(new URL("../server.js", import.meta.url), "utf8");
  assert.match(serverSource, /forexAutoEnabled/);
  assert.doesNotMatch(serverSource.slice(serverSource.indexOf("runForexEngineCycle,")), /autoTradingEnabled && runForexEngineCycle/);
});

test("OANDA token alone can look up the practice account id", async () => {
  const client = createOandaClient({
    token: "practice-token-only",
    accountId: "",
    fetchImpl: async (url) => {
      assert.match(String(url), /\/v3\/accounts$/);
      return {
        ok: true,
        async text() {
          return JSON.stringify({ accounts: [{ id: "101-001-555-001" }] });
        },
      };
    },
  });
  assert.equal(client.accountId, "");
  assert.equal(await client.resolveAccountId(), "101-001-555-001");
  assert.equal(client.accountId, "101-001-555-001");
});

test("Render OANDA_API_KEY is enough and live hosts are forced back to practice", async () => {
  const { resolveOandaEnv } = await import("../forex/oandaEnv.js");
  const fromKey = resolveOandaEnv({ OANDA_API_KEY: "practice-secret" });
  assert.equal(fromKey.token, "practice-secret");
  assert.equal(fromKey.accountId, "");
  assert.equal(fromKey.baseUrl, FOREX_SPEC.practiceApiUrl);
  const liveBlocked = resolveOandaEnv({
    OANDA_API_KEY: "x",
    OANDA_API_URL: "https://api-fxtrade.oanda.com",
  });
  assert.equal(liveBlocked.liveUrlRejected, true);
  assert.equal(liveBlocked.baseUrl, FOREX_SPEC.practiceApiUrl);
});
