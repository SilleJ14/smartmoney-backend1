import test from "node:test";
import assert from "node:assert/strict";
import { registerOperationalControlRoutes } from "../routes/operationalControlRoutes.js";

function harness(initial = {}) {
  const routes = new Map();
  const events = [];
  let state = {
    emergencyStopActive: false,
    autoTradingEnabled: false,
    dailyLossLocked: false,
    profitLocked: false,
    ...initial,
  };
  const app = { post: (path, _middleware, handler) => routes.set(path, handler) };
  registerOperationalControlRoutes(app, {
    requireAdmin: (_req, _res, next) => next(),
    getControlState: () => state,
    updateControlState: (updates) => (state = { ...state, ...updates }),
    recordOrder: (type) => events.push(type),
    getClientIp: () => "127.0.0.1",
    saveEngineState: (type) => events.push(type),
  });
  const invoke = async (path, body = {}) => {
    const response = { statusCode: 200 };
    response.status = (code) => { response.statusCode = code; return response; };
    response.json = (payload) => { response.body = payload; return response; };
    await routes.get(path)({ body }, response);
    return response;
  };
  return { invoke, getState: () => state, events };
}

test("emergency stop disables automated buying", async () => {
  const api = harness({ autoTradingEnabled: true });
  const response = await api.invoke("/emergency-stop");
  assert.equal(response.statusCode, 200);
  assert.equal(api.getState().emergencyStopActive, true);
  assert.equal(api.getState().autoTradingEnabled, false);
  assert.deepEqual(api.events, ["EMERGENCY_STOP_ENGAGED", "EMERGENCY_STOP_ENGAGED"]);
});

test("emergency release requires an exact confirmation", async () => {
  const api = harness({ emergencyStopActive: true });
  const rejected = await api.invoke("/emergency-stop/release", { confirmation: "release" });
  assert.equal(rejected.statusCode, 400);
  assert.equal(api.getState().emergencyStopActive, true);
  const accepted = await api.invoke("/emergency-stop/release", {
    confirmation: "RELEASE EMERGENCY STOP",
  });
  assert.equal(accepted.statusCode, 200);
  assert.equal(api.getState().emergencyStopActive, false);
});

test("automation remains blocked by operational locks", async () => {
  const emergency = harness({ emergencyStopActive: true });
  assert.equal((await emergency.invoke("/auto-trading/on")).statusCode, 423);
  const dailyLoss = harness({ dailyLossLocked: true });
  assert.equal((await dailyLoss.invoke("/auto-trading/on")).statusCode, 403);
  const healthy = harness();
  assert.equal((await healthy.invoke("/auto-trading/on")).statusCode, 200);
  assert.equal(healthy.getState().autoTradingEnabled, true);
});
