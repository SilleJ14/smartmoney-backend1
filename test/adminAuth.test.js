import test from "node:test";
import assert from "node:assert/strict";
import { createAdminAuth } from "../security/adminAuth.js";

test("admin auth accepts token and one-use same-IP stream tickets", () => {
  let handler, issued; const auth = createAdminAuth({ adminToken: "secret", now: () => 1000 });
  auth.registerRoutes({ post: (_path, _guard, route) => { handler = route; } });
  handler({ headers: {}, ip: "1", body: {} }, { json: (body) => { issued = body; } });
  const makeRes = () => ({ status(code) { this.code = code; return this; }, json(body) { this.body = body; } });
  let passed = false; auth.requireAdmin({ method: "GET", headers: {}, ip: "1", query: { streamTicket: issued.ticket } }, makeRes(), () => { passed = true; });
  assert.equal(passed, true);
  const reused = makeRes(); auth.requireAdmin({ method: "GET", headers: {}, ip: "1", query: { streamTicket: issued.ticket } }, reused, () => {});
  assert.equal(reused.code, 401);
});

test("a valid admin token immediately recovers after repeated failures", () => {
  const auth = createAdminAuth({ adminToken: "secret", failureLimit: 2, now: () => 1000 });
  const response = () => ({ status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
  const invalidRequest = { method: "GET", headers: {}, ip: "same-ip", query: {} };
  auth.requireAdmin(invalidRequest, response(), () => {});
  auth.requireAdmin(invalidRequest, response(), () => {});
  let passed = false;
  auth.requireAdmin({ ...invalidRequest, headers: { authorization: "Bearer secret" } }, response(), () => { passed = true; });
  assert.equal(passed, true);
});
