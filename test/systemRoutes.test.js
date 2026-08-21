import test from "node:test";
import assert from "node:assert/strict";
import { registerSystemRoutes } from "../routes/systemRoutes.js";

function setup(overrides = {}) {
  const routes = new Map();
  const app = { get: (path, ...handlers) => routes.set(path, handlers.at(-1)) };
  registerSystemRoutes(app, {
    requireAdmin: () => {}, getSystemSnapshot: () => ({ status: "online" }),
    getInfrastructureSnapshot: () => ({ ok: true }), getClock: async () => ({ is_open: true }),
    getHealthPayload: (clock) => ({ ok: true, marketOpen: clock.is_open }),
    getFallbackMarketOpen: () => false, getEngineRuntime: () => ({ running: false }),
    now: () => new Date("2026-08-21T12:00:00.000Z"), ...overrides,
  });
  const invoke = async (path) => {
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; } };
    await routes.get(path)({}, res); return res;
  };
  return { invoke };
}

test("serves system and infrastructure snapshots", async () => {
  const api = setup();
  assert.equal((await api.invoke("/")).body.status, "online");
  assert.equal((await api.invoke("/infra-status")).body.savedAt, "2026-08-21T12:00:00.000Z");
});

test("health tolerates clock failure using cached market state", async () => {
  const api = setup({ getClock: async () => { throw new Error("clock down"); }, getFallbackMarketOpen: () => true });
  const response = await api.invoke("/health");
  assert.equal(response.body.ok, true);
  assert.equal(response.body.marketOpen, true);
});
