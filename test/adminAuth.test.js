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

test("owner recovery codes are admin-only, expire, are single-use, and invalidate old sessions", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "smartmoney-recovery-"));
  const routes = new Map(); let timestamp = 1000;
  const app = {
    post(route, ...handlers) { routes.set(`POST ${route}`, handlers); },
    get(route, ...handlers) { routes.set(`GET ${route}`, handlers); },
  };
  const auth = createAdminAuth({ adminToken: "server-secret", userFile: path.join(directory, "users.json"), now: () => timestamp });
  auth.registerRoutes(app);
  const response = () => ({ status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
  const run = (route, req, res) => {
    const handlers = routes.get(`POST ${route}`); let index = 0;
    const next = () => handlers[index++](req, res, next);
    next();
  };
  const signup = response();
  run("/auth/signup", { headers: {}, ip: "1", body: { email: "owner@example.com", password: "old-password!", name: "Owner" } }, signup);
  const denied = response();
  run("/auth/admin/recovery-code", { method: "POST", headers: {}, ip: "1", body: { email: "owner@example.com" } }, denied);
  assert.equal(denied.code, 401);
  const issued = response();
  run("/auth/admin/recovery-code", { method: "POST", headers: { authorization: "Bearer server-secret" }, ip: "1", body: {} }, issued);
  assert.equal(issued.body.email, "owner@example.com");
  assert.match(issued.body.code, /^\d{8}$/);
  const reset = response();
  run("/auth/reset-password", { headers: {}, ip: "2", body: { email: "owner@example.com", code: issued.body.code, newPassword: "new-password!" } }, reset);
  assert.ok(reset.body.token);
  assert.equal(auth.sessionUser(signup.body.token), null);
  assert.ok(auth.sessionUser(reset.body.token));
  const reused = response();
  run("/auth/reset-password", { headers: {}, ip: "2", body: { email: "owner@example.com", code: issued.body.code, newPassword: "other-password!" } }, reused);
  assert.equal(reused.code, 401);
  timestamp += 11 * 60 * 1000;
  fs.rmSync(directory, { recursive: true, force: true });
});

test("admin owner repair replaces inconsistent account state and issues a recovery code", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "smartmoney-owner-repair-"));
  const routes = new Map();
  const app = {
    post(route, ...handlers) { routes.set(`POST ${route}`, handlers); },
    get(route, ...handlers) { routes.set(`GET ${route}`, handlers); },
  };
  const auth = createAdminAuth({
    adminToken: "server-secret",
    userFile: path.join(directory, "users.json"),
    now: () => 1000,
  });
  auth.registerRoutes(app);
  const response = () => ({ status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
  const run = (route, req, res) => {
    const handlers = routes.get(`POST ${route}`); let index = 0;
    const next = () => handlers[index++](req, res, next);
    next();
  };

  const signup = response();
  run("/auth/signup", { headers: {}, ip: "1", body: { email: "wrong@example.com", password: "old-password!", name: "Old Owner" } }, signup);

  const missingConfirmation = response();
  run("/auth/admin/repair-owner", {
    method: "POST",
    headers: { authorization: "Bearer server-secret" },
    ip: "1",
    body: { email: "owner@example.com" },
  }, missingConfirmation);
  assert.equal(missingConfirmation.code, 400);

  const repaired = response();
  run("/auth/admin/repair-owner", {
    method: "POST",
    headers: { authorization: "Bearer server-secret" },
    ip: "1",
    body: {
      email: "owner@example.com",
      name: "Owner",
      confirmation: "REPAIR_SMARTMONEY_OWNER",
    },
  }, repaired);
  assert.equal(repaired.body.repaired, true);
  assert.equal(repaired.body.email, "owner@example.com");
  assert.match(repaired.body.code, /^\d{8}$/);
  assert.equal(auth.sessionUser(signup.body.token), null);

  const persisted = JSON.parse(fs.readFileSync(path.join(directory, "users.json"), "utf8"));
  assert.deepEqual(persisted.users.map((user) => user.email), ["owner@example.com"]);

  const reset = response();
  run("/auth/reset-password", {
    headers: {},
    ip: "2",
    body: {
      email: "owner@example.com",
      code: repaired.body.code,
      newPassword: "new-password!",
    },
  }, reset);
  assert.ok(reset.body.token);
  assert.ok(auth.sessionUser(reset.body.token));

  fs.rmSync(directory, { recursive: true, force: true });
});

test("Google login verifies the token and only admits a provisioned account", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "smartmoney-google-auth-"));
  const routes = new Map();
  const app = {
    post(route, ...handlers) { routes.set(`POST ${route}`, handlers.at(-1)); },
    get(route, ...handlers) { routes.set(`GET ${route}`, handlers); },
  };
  let verifiedIdentity = { sub: "google-owner-123", email: "owner@example.com", name: "Owner" };
  const auth = createAdminAuth({
    adminToken: "server-secret",
    userFile: path.join(directory, "users.json"),
    googleClientIds: ["google-client.apps.googleusercontent.com"],
    googleTokenVerifier: async ({ idToken, clientIds }) => {
      assert.equal(idToken, "valid-google-token");
      assert.deepEqual(clientIds, ["google-client.apps.googleusercontent.com"]);
      return verifiedIdentity;
    },
    now: () => 1000,
  });
  auth.registerRoutes(app);
  const response = () => ({ status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });

  const signup = response();
  routes.get("POST /auth/signup")({ headers: {}, ip: "1", body: { email: "owner@example.com", password: "twelve-chars!", name: "Owner" } }, signup);

  const googleLogin = response();
  await routes.get("POST /auth/google")({ headers: {}, ip: "1", body: { idToken: "valid-google-token" } }, googleLogin);
  assert.ok(googleLogin.body.token);
  assert.equal(googleLogin.body.user.email, "owner@example.com");
  assert.ok(auth.sessionUser(googleLogin.body.token));

  verifiedIdentity = { sub: "google-stranger-456", email: "stranger@example.com", name: "Stranger" };
  const stranger = response();
  await routes.get("POST /auth/google")({ headers: {}, ip: "2", body: { idToken: "valid-google-token" } }, stranger);
  assert.equal(stranger.code, 403);

  fs.rmSync(directory, { recursive: true, force: true });
});

test("Apple login links only to the existing owner and supports private-email linking with an owner session", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "smartmoney-apple-auth-"));
  const routes = new Map();
  const app = {
    post(route, ...handlers) { routes.set(`POST ${route}`, handlers.at(-1)); },
    get(route, ...handlers) { routes.set(`GET ${route}`, handlers); },
  };
  let verifiedIdentity = { sub: "apple-owner-123", email: "owner@example.com", emailVerified: true };
  const auth = createAdminAuth({
    adminToken: "server-secret",
    userFile: path.join(directory, "users.json"),
    appleClientIds: ["com.sille14.smartmoney"],
    appleTokenVerifier: async ({ identityToken, clientIds }) => {
      assert.equal(identityToken, "valid-apple-token");
      assert.deepEqual(clientIds, ["com.sille14.smartmoney"]);
      return verifiedIdentity;
    },
    now: () => 1000,
  });
  auth.registerRoutes(app);
  const response = () => ({ status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });

  const signup = response();
  routes.get("POST /auth/signup")({ headers: {}, ip: "1", body: { email: "owner@example.com", password: "twelve-chars!", name: "Owner" } }, signup);

  const appleLogin = response();
  await routes.get("POST /auth/apple")({ headers: {}, ip: "1", body: { identityToken: "valid-apple-token" } }, appleLogin);
  assert.ok(appleLogin.body.token);
  assert.equal(appleLogin.body.user.email, "owner@example.com");

  verifiedIdentity = { sub: "apple-stranger-456", email: "private@privaterelay.appleid.com", emailVerified: true };
  const stranger = response();
  await routes.get("POST /auth/apple")({ headers: {}, ip: "2", body: { identityToken: "valid-apple-token" } }, stranger);
  assert.equal(stranger.code, 403);

  const directoryForPrivateEmail = fs.mkdtempSync(path.join(os.tmpdir(), "smartmoney-apple-private-auth-"));
  const privateRoutes = new Map();
  const privateAuth = createAdminAuth({
    adminToken: "server-secret",
    userFile: path.join(directoryForPrivateEmail, "users.json"),
    appleClientIds: ["com.sille14.smartmoney"],
    appleTokenVerifier: async () => verifiedIdentity,
    now: () => 1000,
  });
  privateAuth.registerRoutes({
    post(route, ...handlers) { privateRoutes.set(`POST ${route}`, handlers.at(-1)); },
    get(route, ...handlers) { privateRoutes.set(`GET ${route}`, handlers); },
  });
  const privateSignup = response();
  privateRoutes.get("POST /auth/signup")({ headers: {}, ip: "3", body: { email: "owner@example.com", password: "twelve-chars!", name: "Owner" } }, privateSignup);
  const linked = response();
  await privateRoutes.get("POST /auth/apple")({
    headers: { authorization: `Bearer ${privateSignup.body.token}` },
    ip: "3",
    body: { identityToken: "valid-apple-token" },
  }, linked);
  assert.ok(linked.body.token);
  assert.equal(linked.body.user.email, "owner@example.com");

  fs.rmSync(directory, { recursive: true, force: true });
  fs.rmSync(directoryForPrivateEmail, { recursive: true, force: true });
});
