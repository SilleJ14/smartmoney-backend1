import test from "node:test";
import assert from "node:assert/strict";
import { createBrokerSnapshotService } from "../execution/brokerSnapshotService.js";

function harness(responses = {}) {
  const cache = {};
  const health = [];
  const service = createBrokerSnapshotService({
    tradingRequest: async (path) => {
      const value = responses[path];
      if (value instanceof Error) throw value;
      return value;
    },
    getCache: (key) => cache[key],
    setCache: (key, value) => { cache[key] = value; },
    onApiHealth: (...args) => health.push(args),
  });
  return { service, cache, health };
}

test("stores fresh broker positions in the cache", async () => {
  const positions = [{ symbol: "AAPL", qty: "1" }];
  const { service, cache, health } = harness({ "/v2/positions": positions });
  assert.deepEqual(await service.getPositions(), positions);
  assert.deepEqual(cache.cachedPositions, positions);
  assert.deepEqual(health, [["alpacaPositions", true]]);
});

test("returns cached positions when the broker is unavailable", async () => {
  const { service, cache, health } = harness({ "/v2/positions": new Error("timeout") });
  cache.cachedPositions = [{ symbol: "MSFT", qty: "2" }];
  assert.deepEqual(await service.getPositions(), cache.cachedPositions);
  assert.deepEqual(health, [["alpacaPositions", false, "timeout"]]);
});

test("marks a cached account stale after a failed refresh", async () => {
  const { service, cache } = harness({ "/v2/account": new Error("offline") });
  cache.cachedAccount = { equity: "1000" };
  assert.deepEqual(await service.getAccount(), {
    equity: "1000",
    stale: true,
    staleReason: "offline",
  });
});

test("returns an explicit unavailable account when no cache exists", async () => {
  const { service } = harness({ "/v2/account": new Error("offline") });
  const account = await service.getAccount();
  assert.equal(account.status, "alpaca_account_unavailable");
  assert.equal(account.stale, true);
});
