import test from "node:test";
import assert from "node:assert/strict";
import { registerLiveEngineRoutes } from "../routes/liveEngineRoutes.js";

test("registers live engine snapshots with bounded histories", () => {
  const routes = new Map(), app = { get: (path, ...handlers) => routes.set(path, handlers.at(-1)) };
  registerLiveEngineRoutes(app, { requireAdmin: () => {}, flags: { liveScaleIn: true }, getState: () => ({ liveScaleInState: { active: true }, liveScaleInHistory: Array(30).fill(1) }) });
  const res = { json(body) { this.body = body; } };
  routes.get("/live-scale-in")({}, res);
  assert.equal(res.body.enabled, true);
  assert.equal(res.body.history.length, 25);
  assert.equal(routes.size, 6);
});
