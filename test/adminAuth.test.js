import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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

test("server-backed signup, login and session validation use persisted password hashes", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "smartmoney-auth-"));
  const routes = new Map();
  const app = {
    post(route, ...handlers) { routes.set(`POST ${route}`, handlers.at(-1)); },
    get(route, ...handlers) { routes.set(`GET ${route}`, handlers); },
  };
  const auth = createAdminAuth({ adminToken: "server-secret", userFile: path.join(directory, "users.json"), now: () => 1000 });
  auth.registerRoutes(app);
  const response = () => ({ status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
  const signup = response();
  routes.get("POST /auth/signup")({ headers: {}, ip: "1", body: { email: "owner@example.com", password: "twelve-chars!", name: "Owner" } }, signup);
  assert.equal(signup.code, 201);
  assert.ok(signup.body.token);
  assert.doesNotMatch(fs.readFileSync(path.join(directory, "users.json"), "utf8"), /twelve-chars!/);
  const session = response(); let passed = false;
  auth.requireAdmin({ method: "GET", headers: { authorization: `Bearer ${signup.body.token}` }, ip: "1", query: {} }, session, () => { passed = true; });
  assert.equal(passed, true);
  fs.rmSync(directory, { recursive: true, force: true });
});
