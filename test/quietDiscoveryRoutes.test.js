import test from "node:test";
import assert from "node:assert/strict";
import { registerQuietDiscoveryRoutes } from "../routes/quietDiscoveryRoutes.js";

test("quiet discovery exposes bounded status and an authenticated manual run", async () => {
  const routes = {};
  let runOptions;
  const app = { get: (path, ...handlers) => { routes[`GET ${path}`] = handlers.at(-1); }, post: (path, ...handlers) => { routes[`POST ${path}`] = handlers.at(-1); } };
  registerQuietDiscoveryRoutes(app, { requireAdmin: (_req, _res, next) => next(), getState: () => ({ boundedQuietDiscoveryState: { watchlistCount: 2 } }), getStoreStats: () => ({ bytes: 100 }), runDiscovery: async (options) => { runOptions = options; return { ok: true, watchlistCount: 3 }; } });
  let payload;
  routes["GET /discovery/quiet"]({}, { json: (value) => { payload = value; } });
  assert.equal(payload.state.watchlistCount, 2);
  await routes["POST /discovery/quiet/run"]({}, { json: (value) => { payload = value; }, status: () => ({ json: () => {} }) });
  assert.equal(payload.state.watchlistCount, 3);
  assert.deepEqual(runOptions, { force: true });
});
