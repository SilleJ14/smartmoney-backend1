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

test("health uses fresh cached clock without calling the broker", async () => {
  const api = setup({ getClock: () => { throw new Error("must not call broker"); },
    getCachedClock: () => ({ is_open: true, timestamp: "2026-08-21T11:59:55.000Z" }) });
  const response = await api.invoke("/health");
  assert.equal(response.body.ok, true);
  assert.equal(response.body.marketOpen, true);
  assert.equal(response.body.release.id, "discovery-scoring-safety-2026-08-26");
  assert.ok(Object.hasOwn(response.body.release, "commit"));
});

test("health stays responsive with unavailable, old, or future clock and fails closed", async () => {
  for (const clock of [null, { is_open: true, timestamp: "2026-08-20T12:00:00Z" },
    { is_open: true, timestamp: "2026-08-22T12:00:00Z" }]) {
    let calls = 0;
    const api = setup({ getClock: () => { calls++; return new Promise(() => {}); }, getCachedClock: () => clock });
    const result = await api.invoke('/health');
    assert.equal(result.statusCode, 200);
    assert.equal(result.body.marketOpen, false);
    assert.equal(calls, 0);
  }
});
