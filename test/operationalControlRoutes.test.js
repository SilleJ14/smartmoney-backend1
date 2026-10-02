import test from "node:test";
import assert from "node:assert/strict";
import {
  registerOperationalControlRoutes,
  RELEASE_CONFIRMATION,
  RELEASE_MASTER_CONFIRMATION,
} from "../routes/operationalControlRoutes.js";

function install() {
  const routes = new Map();
  const saved = [];
  let control = { emergencyStopActive: true, autoTradingEnabled: false, dailyLossLocked: false, profitLocked: true };
  registerOperationalControlRoutes({ post: (route, ...handlers) => routes.set(route, handlers.at(-1)) }, {
    requireAdmin: () => {},
    getControlState: () => control,
    updateControlState: (updates) => {
      control = { ...control, ...updates };
      return control;
    },
    recordOrder: (...args) => saved.push(args),
    getClientIp: () => "127.0.0.1",
    saveEngineState: (reason) => saved.push(["save", reason]),
  });
  const call = async (route, body = {}) => {
    const res = { status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
    await routes.get(route)({ body }, res);
    return res;
  };
  return { call, getControl: () => control, saved };
}

test("releasing emergency stop arms Autopilot on the server", async () => {
  const { call, getControl } = install();
  const denied = await call("/emergency-stop/release", { confirmation: "no" });
  assert.equal(denied.statusCode, 400);
  assert.equal(getControl().autoTradingEnabled, false);
  const released = await call("/emergency-stop/release", { confirmation: RELEASE_CONFIRMATION });
  assert.equal(released.body.emergencyStopActive, false);
  assert.equal(released.body.autoTradingEnabled, true);
  assert.equal(getControl().autoTradingEnabled, true);
});

test("profit lock does not block turning Autopilot on after stop is released", async () => {
  const { call, getControl } = install();
  await call("/emergency-stop/release", { confirmation: RELEASE_CONFIRMATION });
  const on = await call("/auto-trading/on");
  assert.equal(on.body.autoTradingEnabled, true);
  const off = await call("/auto-trading/off");
  assert.equal(off.statusCode, 423);
  assert.equal(getControl().autoTradingEnabled, true);
});

test("master kill switch stops both engines and release never arms either", async () => {
  const { call, getControl } = install();
  const engaged = await call("/master-kill-switch");
  assert.equal(engaged.body.emergencyStopActive, true);
  assert.equal(engaged.body.forexEmergencyStopActive, true);
  assert.equal(getControl().autoTradingEnabled, false);
  assert.equal(getControl().forexAutoEnabled, false);
  assert.equal(getControl().forexPauseEntries, true);

  const denied = await call("/master-kill-switch/release", { confirmation: "no" });
  assert.equal(denied.statusCode, 400);
  const released = await call("/master-kill-switch/release", {
    confirmation: RELEASE_MASTER_CONFIRMATION,
  });
  assert.equal(released.body.emergencyStopActive, false);
  assert.equal(released.body.forexEmergencyStopActive, false);
  assert.equal(released.body.autoTradingEnabled, false);
  assert.equal(released.body.forexAutoEnabled, false);
  assert.equal(getControl().forexPauseEntries, false);
});
