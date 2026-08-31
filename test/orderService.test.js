import test from "node:test";
import assert from "node:assert/strict";

import { createOrderService } from "../execution/orderService.js";

function harness() {
  const requests = [];
  const service = createOrderService({
    tradingRequest: async (path, options) => {
      requests.push({ path, options, body: options.body ? JSON.parse(options.body) : null });
      return { id: "order-1" };
    },
    normalizeSymbol: (symbol) => String(symbol || "").trim().toUpperCase(),
    clientOrderPrefix: "TEST",
    now: () => 123456,
  });
  return { service, requests };
}

test("builds a fractional stock market buy", async () => {
  const { service, requests } = harness();
  await service.stockBuy({
    symbol: "aapl",
    dollars: 25.129,
    score: 88.6,
    marketOpen: true,
    fractionable: true,
    referencePrice: 200,
    holdCategory: "intraday",
  });
  assert.deepEqual(requests[0].body, {
    symbol: "AAPL",
    side: "buy",
    time_in_force: "day",
    client_order_id: "TEST_BUY_AAPL_89_123456",
    notional: 25.13,
    type: "market",
  });
});

test("converts a non-fractionable stock buy to whole shares", async () => {
  const { service, requests } = harness();
  await service.stockBuy({
    symbol: "BRK.A",
    dollars: 1000,
    marketOpen: true,
    fractionable: false,
    referencePrice: 400,
    holdCategory: "multi_day",
  });
  assert.equal(requests[0].body.qty, "2");
  assert.equal(requests[0].body.type, "market");
  assert.equal(requests[0].body.notional, undefined);
});

test("rejects a whole-share buy that cannot afford one share", async () => {
  const { service, requests } = harness();
  assert.throws(() => service.stockBuy({
      symbol: "AAPL",
      dollars: 25,
      marketOpen: true,
      fractionable: false,
      referencePrice: 200,
      holdCategory: "intraday",
    }), /not enough for 1 share/);
  assert.equal(requests.length, 0);
});

test("rejects stock buys while the regular market is closed", () => {
  const { service, requests } = harness();
  assert.throws(() => service.stockBuy({
    symbol: "AAPL",
    dollars: 25,
    marketOpen: false,
    fractionable: true,
    referencePrice: 100,
  }), /regular market is open/i);
  assert.equal(requests.length, 0);
});

test("rejects stock sells while the regular market is closed", () => {
  const { service, requests } = harness();
  assert.throws(() => service.stockSell({
    symbol: "AAPL",
    qty: 2.75,
    reason: "RISK_EXIT",
    marketOpen: false,
    fractionable: true,
    referencePrice: 100,
  }), /regular market is open/i);
  assert.equal(requests.length, 0);
});

test("rounds non-fractionable sell quantities down", async () => {
  const { service, requests } = harness();
  await service.stockSell({
    symbol: "AAPL",
    qty: 2.75,
    marketOpen: true,
    fractionable: false,
  });
  assert.equal(requests[0].body.qty, "2");
});

test("manual dollar buys use notional only for fractionable assets", async () => {
  const { service, requests } = harness();
  await service.manualStockBuy({
    symbol: "AAPL",
    dollars: 50.126,
    buyMode: "dollars",
    fractionable: true,
    marketOpen: true,
    holdCategory: "intraday",
  });
  assert.equal(requests[0].body.notional, 50.13);
});

test("stock buys fail closed when holding category is missing", () => {
  const { service, requests } = harness();
  assert.throws(() => service.stockBuy({
    symbol: "AAPL",
    dollars: 25,
    marketOpen: true,
    fractionable: true,
    referencePrice: 100,
  }), /holding category is required/i);
  assert.equal(requests.length, 0);
});

test("manual stock buys also reject a closed regular market", () => {
  const { service, requests } = harness();
  assert.throws(() => service.manualStockBuy({
    symbol: "AAPL",
    dollars: 50,
    buyMode: "dollars",
    fractionable: true,
    marketOpen: false,
  }), /regular market is open/i);
  assert.equal(requests.length, 0);
});

test("builds crypto orders with GTC time in force", async () => {
  const { service, requests } = harness();
  await service.cryptoMarketBuy({ symbol: "btc/usd", dollars: 25 });
  await service.cryptoMarketSell({ symbol: "btc/usd", qty: 0.01 });
  assert.equal(requests[0].body.time_in_force, "gtc");
  assert.equal(requests[0].body.side, "buy");
  assert.equal(requests[1].body.time_in_force, "gtc");
  assert.equal(requests[1].body.side, "sell");
  assert.equal(requests.some((request) => request.body?.extended_hours === true), false);
});

test("close position encodes the normalized symbol", async () => {
  const { service, requests } = harness();
  await service.closePosition("btc/usd");
  assert.equal(requests[0].path, "/v2/positions/BTC%2FUSD");
  assert.equal(requests[0].options.method, "DELETE");
});

test("runs close-position requests through the duplicate sell guard", async () => {
  const requests = [];
  const reservations = [];
  const service = createOrderService({
    tradingRequest: async (path, options) => {
      requests.push({ path, options });
      return { ok: true };
    },
    normalizeSymbol: (symbol) => String(symbol || "").trim().toUpperCase(),
    duplicateOrderGuard: {
      reserve: async (order) => {
        reservations.push(order);
        return () => {};
      },
    },
  });
  await service.closePosition("aapl");
  assert.deepEqual(reservations, [{ symbol: "AAPL", side: "sell" }]);
  assert.equal(requests.length, 1);
});
