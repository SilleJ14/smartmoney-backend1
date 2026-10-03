import test from "node:test";
import assert from "node:assert/strict";

import { createAlpacaClient } from "../execution/alpacaClient.js";

function response({ ok = true, status = 200, body = {} } = {}) {
  return {
    ok,
    status,
    text: async () => JSON.stringify(body),
  };
}

function createHarness(overrides = {}) {
  const calls = [];
  const health = [];
  const failures = [];
  const client = createAlpacaClient({
    getKeys: () => ({ key: "test-key", secret: "test-secret" }),
    getTradingBaseUrl: () => "https://trading.example",
    dataBaseUrl: "https://data.example",
    fetchWithTimeout: async (url, options) => {
      calls.push({ url, options });
      return response();
    },
    onApiHealth: (...args) => health.push(args),
    onTradingFailure: (message) => failures.push(message),
    ...overrides,
  });
  return { client, calls, health, failures };
}

test("adds Alpaca credentials and preserves caller headers", async () => {
  const { client, calls } = createHarness();
  await client.tradingRequest("/v2/account", {
    headers: { "x-request-id": "request-1" },
  });

  assert.equal(calls[0].url, "https://trading.example/v2/account");
  assert.equal(calls[0].options.headers["APCA-API-KEY-ID"], "test-key");
  assert.equal(calls[0].options.headers["APCA-API-SECRET-KEY"], "test-secret");
  assert.equal(calls[0].options.headers["x-request-id"], "request-1");
});

test("blocks emergency buys before making a network request", async () => {
  const { client, calls } = createHarness({ isEmergencyStopActive: () => true });
  await assert.rejects(
    client.tradingRequest("/v2/orders", {
      method: "POST",
      body: JSON.stringify({ side: "buy", symbol: "AAPL" }),
    }),
    /New buy orders are blocked/
  );
  assert.equal(calls.length, 0);
});

test("allows emergency sells to reach Alpaca", async () => {
  const { client, calls } = createHarness({ isEmergencyStopActive: () => true });
  await client.tradingRequest("/v2/orders", {
    method: "POST",
    body: JSON.stringify({ side: "sell", symbol: "AAPL" }),
  });
  assert.equal(calls.length, 1);
});

test("records broker failures and reports API health", async () => {
  const { client, health, failures } = createHarness({
    fetchWithTimeout: async () => response({
      ok: false,
      status: 422,
      body: { message: "order rejected" },
    }),
  });

  await assert.rejects(client.tradingRequest("/v2/orders", {
    method: "POST",
    body: JSON.stringify({ side: "sell" }),
  }), /order rejected/);
  assert.deepEqual(failures, ["order rejected"]);
  assert.deepEqual(health, [["alpacaTrading", false, "order rejected"]]);
});

test("after a 429, read requests wait out the backoff while orders and the clock still go through", async () => {
  const { createAlpacaClient: create } = await import("../execution/alpacaClient.js");
  let clock = 1_000_000;
  const calls = [];
  let limited = true;
  const client = create({
    getKeys: () => ({ key: "test-key", secret: "test-secret" }),
    getTradingBaseUrl: () => "https://paper-api.alpaca.markets",
    dataBaseUrl: "https://data.alpaca.markets",
    now: () => clock,
    fetchWithTimeout: async (url, options) => {
      calls.push(`${options.method || "GET"} ${new URL(url).pathname}`);
      return limited
        ? new Response(JSON.stringify({ message: "rate limit exceeded" }), { status: 429 })
        : new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
  });
  await assert.rejects(client.tradingRequest("/v2/positions"), { status: 429 });
  assert.equal(calls.length, 1);
  await assert.rejects(client.tradingRequest("/v2/account"), { code: "ALPACA_RATE_LIMIT_BACKOFF" });
  assert.equal(calls.length, 1, "a read inside the backoff never reaches Alpaca");
  limited = false;
  await client.tradingRequest("/v2/orders", { method: "POST", body: JSON.stringify({ symbol: "AAPL", qty: "1", side: "sell", type: "market", time_in_force: "day" }) });
  await client.tradingRequest("/v2/clock");
  assert.deepEqual(calls.slice(1), ["POST /v2/orders", "GET /v2/clock"]);
  clock += 16_000;
  assert.deepEqual(await client.tradingRequest("/v2/account"), { ok: true });
  // A second limit in a row doubles the wait (15 s -> 30 s).
  limited = true;
  await assert.rejects(client.tradingRequest("/v2/positions"), { status: 429 });
  clock += 16_000;
  await assert.rejects(client.tradingRequest("/v2/positions"), { status: 429 });
  clock += 16_000;
  await assert.rejects(client.tradingRequest("/v2/positions"), { code: "ALPACA_RATE_LIMIT_BACKOFF" });
  clock += 15_000;
  limited = false;
  assert.deepEqual(await client.tradingRequest("/v2/positions"), { ok: true });
});

test("exit reads bypass the backoff, a burst counts once, and no Retry-After blocks reads for more than 60 s", async () => {
  const { createAlpacaClient: create } = await import("../execution/alpacaClient.js");
  let clock = 5_000_000;
  let limited = true;
  let retryAfter = null;
  const calls = [];
  const client = create({
    getKeys: () => ({ key: "test-key", secret: "test-secret" }),
    getTradingBaseUrl: () => "https://paper-api.alpaca.markets",
    dataBaseUrl: "https://data.alpaca.markets",
    now: () => clock,
    fetchWithTimeout: async (url, options) => {
      calls.push(new URL(url).pathname);
      if (!limited) return new Response("{}", { status: 200 });
      return new Response("{}", { status: 429, headers: retryAfter ? { "retry-after": retryAfter } : {} });
    },
  });
  // Five parallel 429s are one event: a 15 s window, not 60 s.
  await Promise.allSettled(Array.from({ length: 5 }, () => client.tradingRequest("/v2/positions")));
  clock += 16_000;
  limited = false;
  assert.deepEqual(await client.tradingRequest("/v2/positions"), {});
  // Protection reads still reach Alpaca during a window.
  limited = true;
  await assert.rejects(client.tradingRequest("/v2/account"), { status: 429 });
  limited = false;
  const before = calls.length;
  assert.deepEqual(await client.tradingRequest("/v2/orders?status=open", { bypassRateLimitBackoff: true }), {});
  assert.equal(calls.length, before + 1);
  await assert.rejects(client.tradingRequest("/v2/account"), { code: "ALPACA_RATE_LIMIT_BACKOFF" });
  // A huge Retry-After is capped at 60 s.
  clock += 120_000;
  limited = true; retryAfter = "3600";
  await assert.rejects(client.tradingRequest("/v2/account"), { status: 429 });
  clock += 61_000; limited = false;
  assert.deepEqual(await client.tradingRequest("/v2/account"), {});
});
