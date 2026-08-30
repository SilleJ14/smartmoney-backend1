import test from "node:test";
import assert from "node:assert/strict";
import { registerConfigRoutes } from "../routes/configRoutes.js";

function harness(control = {}) {
  const routes = new Map();
  const applied = [];
  const app = {
    get: (path, _middleware, handler) => routes.set(`GET ${path}`, handler),
    post: (path, _middleware, handler) => routes.set(`POST ${path}`, handler),
  };
  registerConfigRoutes(app, {
    requireAdmin: (_req, _res, next) => next(),
    getConfig: () => ({}),
    getRuntimeConfig: () => ({}),
    isEmergencyStopped: () => false,
    getControlState: () => ({
      emergencyStopActive: false,
      dailyLossLocked: false,
      profitLocked: false,
      ...control,
    }),
    resetRuntimeConfig: () => {},
    applyPermanentUpdates: (updates) => { applied.push(updates); return { ok: true }; },
    applyApiUpdates: (updates) => { applied.push(updates); return { autoTradingEnabled: updates.autoTradingEnabled }; },
  });
  const invoke = async (path, body = {}) => {
    const response = { statusCode: 200 };
    response.status = (code) => { response.statusCode = code; return response; };
    response.json = (payload) => { response.body = payload; return response; };
    await routes.get(`POST ${path}`)({ body }, response);
    return response;
  };
  return { invoke, applied };
}

test("generic config endpoints cannot bypass operational automation locks", async () => {
  for (const [state, expectedStatus] of [
    [{ emergencyStopActive: true }, 423],
    [{ dailyLossLocked: true }, 403],
    [{ profitLocked: true }, 403],
  ]) {
    for (const path of ["/config", "/api/config"]) {
      const api = harness(state);
      const response = await api.invoke(path, { autoTradingEnabled: true });
      assert.equal(response.statusCode, expectedStatus);
      assert.equal(api.applied.length, 0);
    }
  }
});

test("generic config endpoints still allow pausing automation", async () => {
  const api = harness({ emergencyStopActive: true, dailyLossLocked: true, profitLocked: true });
  const response = await api.invoke("/api/config", { autoTradingEnabled: false });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(api.applied, [{ autoTradingEnabled: false }]);
});

test("api config validates numeric values and strips non-config persistence flags", async () => {
  const api = harness();
  const invalid = await api.invoke("/api/config", { maxBotExposurePercent: "bad" });
  assert.equal(invalid.statusCode, 400);
  assert.equal(api.applied.length, 0);

  const valid = await api.invoke("/api/config", {
    maxBotExposurePercent: "15",
    dailyLossLimitPercent: "2",
    persist: true,
    permanent: true,
  });
  assert.equal(valid.statusCode, 200);
  assert.deepEqual(api.applied, [{ maxBotExposurePercent: 15, dailyLossLimitPercent: 2 }]);
});
