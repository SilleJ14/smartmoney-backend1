import crypto from "crypto";
import fs from "fs";
import path from "path";

const normalizeIdentity = (value) => String(value || "").trim().toLowerCase();
const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");

function passwordDigest(password, salt = crypto.randomBytes(16).toString("base64url")) {
  return { salt, digest: crypto.scryptSync(String(password), salt, 64).toString("base64url") };
}

function passwordIsValid(password, user = {}) {
  if (!user.salt || !user.passwordDigest) return false;
  const actual = Buffer.from(passwordDigest(password, user.salt).digest);
  const expected = Buffer.from(String(user.passwordDigest));
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function safeUsers(file) {
  try {
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    return Array.isArray(value?.users) ? value.users.slice(0, 10) : [];
  } catch { return []; }
}

function persistUsers(file, users) {
  if (!file) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify({ version: 1, users: users.slice(0, 10) }, null, 2), { mode: 0o600 });
  fs.renameSync(temporary, file);
}

export function createAdminAuth({ adminToken, userFile = "", sessionTtlMs = 12 * 60 * 60 * 1000,
  failureWindowMs = 15 * 60 * 1000, failureLimit = 20, ticketTtlMs = 30 * 1000,
  recoveryTtlMs = 10 * 60 * 1000, now = () => Date.now() }) {
  const failures = new Map(), tickets = new Map(), recoveryCodes = new Map();
  let users = userFile ? safeUsers(userFile) : [];
  const signingKey = crypto.createHash("sha256").update(String(adminToken || "missing-admin-token")).digest();
  const getClientIp = (req) => String(req.headers["x-forwarded-for"] || req.ip || "unknown").split(",")[0].trim();
  const publicUser = (user) => ({ id: user.id, name: user.name, email: user.email, createdAt: user.createdAt });
  const signSession = (user) => {
    const payload = encode({ sub: user.id, email: user.email, ver: user.authVersion || user.passwordChangedAt || user.createdAt,
      iat: now(), exp: now() + sessionTtlMs });
    const signature = crypto.createHmac("sha256", signingKey).update(payload).digest("base64url");
    return `${payload}.${signature}`;
  };
  const sessionUser = (token) => {
    try {
      const [payload, signature] = String(token || "").split(".");
      if (!payload || !signature) return null;
      const expected = crypto.createHmac("sha256", signingKey).update(payload).digest();
      const actual = Buffer.from(signature, "base64url");
      if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;
      const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
      if (!claims.sub || Number(claims.exp) <= now()) return null;
      const user = users.find((candidate) => candidate.id === claims.sub) || null;
      return user && claims.ver === (user.authVersion || user.passwordChangedAt || user.createdAt) ? user : null;
    } catch { return null; }
  };
  const bearerOf = (req) => {
    const auth = String(req.headers.authorization || "");
    return auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  };
  const recoveryDigest = (code) => crypto.createHmac("sha256", signingKey).update(String(code)).digest();
  const recoveryCodeIsValid = (provided, record) => {
    if (!record || record.expiresAt <= now() || record.attempts >= 5) return false;
    const actual = recoveryDigest(provided);
    return actual.length === record.digest.length && crypto.timingSafeEqual(actual, record.digest);
  };
  const recordFailure = (req, res, message = "Invalid email or password") => {
    const clientIp = getClientIp(req), timestamp = now();
    const failure = failures.get(clientIp);
    if (failure && failure.resetAt > timestamp && failure.count >= failureLimit) {
      return res.status(429).json({ ok: false, error: "Too many authentication failures" });
    }
    const active = failure && failure.resetAt > timestamp ? failure : { count: 0, resetAt: timestamp + failureWindowMs };
    active.count += 1; failures.set(clientIp, active);
    return res.status(401).json({ ok: false, error: message });
  };
  const requireAdmin = (req, res, next) => {
    if (!adminToken) return res.status(500).json({ ok: false, error: "ADMIN_API_TOKEN is not set on backend" });
    const bearer = bearerOf(req);
    const provided = bearer || String(req.headers["x-admin-token"] || "").trim();
    const streamTicket = req.method === "GET" ? String(req.query?.streamTicket || "").trim() : "";
    const record = streamTicket ? tickets.get(streamTicket) : null, clientIp = getClientIp(req), timestamp = now();
    const validTicket = Boolean(record && record.expiresAt > timestamp && record.ip === clientIp);
    if (validTicket) tickets.delete(streamTicket);
    const user = sessionUser(provided);
    if (validTicket || provided === adminToken || user) {
      failures.delete(clientIp);
      if (user) req.authUser = publicUser(user);
      return next();
    }
    return recordFailure(req, res, "Unauthorized");
  };
  const registerRoutes = (app) => {
    app.post("/auth/signup", (req, res) => {
      const email = normalizeIdentity(req.body?.email), password = String(req.body?.password || ""), name = String(req.body?.name || "").trim();
      if (users.length > 0) return res.status(403).json({ ok: false, error: "Account creation is closed. Ask the server owner to provision access." });
      if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ ok: false, error: "Enter a valid email address" });
      if (password.length < 12) return res.status(400).json({ ok: false, error: "Password must contain at least 12 characters" });
      const passwordRecord = passwordDigest(password);
      const user = { id: crypto.randomUUID(), email, name: name.slice(0, 80) || "SmartMoney Owner", salt: passwordRecord.salt,
        passwordDigest: passwordRecord.digest, createdAt: new Date(now()).toISOString() };
      users = [user]; persistUsers(userFile, users);
      return res.status(201).json({ ok: true, token: signSession(user), expiresInSeconds: sessionTtlMs / 1000, user: publicUser(user) });
    });
    app.post("/auth/login", (req, res) => {
      const email = normalizeIdentity(req.body?.email), password = String(req.body?.password || "");
      const user = users.find((candidate) => candidate.email === email);
      if (!user || !passwordIsValid(password, user)) return recordFailure(req, res);
      failures.delete(getClientIp(req));
      return res.json({ ok: true, token: signSession(user), expiresInSeconds: sessionTtlMs / 1000, user: publicUser(user) });
    });
    app.post("/auth/admin/recovery-code", requireAdmin, (req, res) => {
      if (req.authUser) return res.status(403).json({ ok: false, error: "The backend administrator token is required" });
      const email = normalizeIdentity(req.body?.email);
      const user = email ? users.find((candidate) => candidate.email === email) : users.length === 1 ? users[0] : null;
      if (!user) return res.status(404).json({ ok: false, error: "Account not found" });
      const code = crypto.randomInt(0, 100000000).toString().padStart(8, "0");
      recoveryCodes.set(user.id, { digest: recoveryDigest(code), expiresAt: now() + recoveryTtlMs, attempts: 0 });
      return res.json({ ok: true, email: user.email, code, expiresInSeconds: recoveryTtlMs / 1000 });
    });
    app.post("/auth/admin/repair-owner", requireAdmin, (req, res) => {
      if (req.authUser) return res.status(403).json({ ok: false, error: "The backend administrator token is required" });
      if (String(req.body?.confirmation || "") !== "REPAIR_SMARTMONEY_OWNER") {
        return res.status(400).json({ ok: false, error: "Exact owner-repair confirmation is required" });
      }
      const email = normalizeIdentity(req.body?.email);
      const name = String(req.body?.name || "").trim().slice(0, 80) || "SmartMoney Owner";
      if (!/^\S+@\S+\.\S+$/.test(email)) {
        return res.status(400).json({ ok: false, error: "Enter a valid email address" });
      }

      const existing = users.find((candidate) => candidate.email === email) || users[0] || {};
      const placeholderPassword = passwordDigest(crypto.randomBytes(48).toString("base64url"));
      const repairedAt = new Date(now()).toISOString();
      const user = {
        id: existing.id || crypto.randomUUID(),
        email,
        name,
        salt: placeholderPassword.salt,
        passwordDigest: placeholderPassword.digest,
        createdAt: existing.createdAt || repairedAt,
        passwordChangedAt: repairedAt,
        authVersion: crypto.randomUUID(),
      };

      users = [user];
      recoveryCodes.clear();
      persistUsers(userFile, users);
      const code = crypto.randomInt(0, 100000000).toString().padStart(8, "0");
      recoveryCodes.set(user.id, { digest: recoveryDigest(code), expiresAt: now() + recoveryTtlMs, attempts: 0 });
      failures.delete(getClientIp(req));
      return res.json({
        ok: true,
        repaired: true,
        email: user.email,
        code,
        expiresInSeconds: recoveryTtlMs / 1000,
      });
    });
    app.post("/auth/reset-password", (req, res) => {
      const email = normalizeIdentity(req.body?.email);
      const code = String(req.body?.code || "").trim();
      const newPassword = String(req.body?.newPassword || "");
      const user = users.find((candidate) => candidate.email === email);
      const record = user ? recoveryCodes.get(user.id) : null;
      if (!user || !recoveryCodeIsValid(code, record)) {
        if (record) record.attempts += 1;
        return recordFailure(req, res, "Invalid or expired recovery code");
      }
      if (newPassword.length < 12) return res.status(400).json({ ok: false, error: "New password must contain at least 12 characters" });
      const passwordRecord = passwordDigest(newPassword);
      Object.assign(user, { salt: passwordRecord.salt, passwordDigest: passwordRecord.digest,
        passwordChangedAt: new Date(now()).toISOString(), authVersion: crypto.randomUUID() });
      recoveryCodes.delete(user.id);
      failures.delete(getClientIp(req));
      persistUsers(userFile, users);
      return res.json({ ok: true, token: signSession(user), expiresInSeconds: sessionTtlMs / 1000, user: publicUser(user) });
    });
    if (typeof app.get === "function") {
      app.get("/auth/session", requireAdmin, (req, res) => res.json({ ok: true, user: req.authUser || null }));
    }
    app.post("/auth/change-password", requireAdmin, (req, res) => {
      if (!req.authUser) return res.status(403).json({ ok: false, error: "A user session is required" });
      const user = users.find((candidate) => candidate.id === req.authUser.id);
      const currentPassword = String(req.body?.currentPassword || ""), newPassword = String(req.body?.newPassword || "");
      if (!passwordIsValid(currentPassword, user)) return recordFailure(req, res, "Current password is incorrect");
      if (newPassword.length < 12) return res.status(400).json({ ok: false, error: "New password must contain at least 12 characters" });
      const passwordRecord = passwordDigest(newPassword);
      Object.assign(user, { salt: passwordRecord.salt, passwordDigest: passwordRecord.digest,
        passwordChangedAt: new Date(now()).toISOString(), authVersion: crypto.randomUUID() });
      persistUsers(userFile, users);
      return res.json({ ok: true, token: signSession(user), expiresInSeconds: sessionTtlMs / 1000, user: publicUser(user) });
    });
    app.post("/auth/stream-ticket", requireAdmin, (req, res) => {
      const ticket = crypto.randomBytes(32).toString("base64url");
      tickets.set(ticket, { ip: getClientIp(req), expiresAt: now() + ticketTtlMs });
      res.json({ ok: true, ticket, expiresInSeconds: ticketTtlMs / 1000 });
    });
  };
  return { requireAdmin, registerRoutes, getClientIp, sessionUser };
}
