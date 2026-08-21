import crypto from "crypto";

export function createAdminAuth({ adminToken, failureWindowMs = 15 * 60 * 1000,
  failureLimit = 20, ticketTtlMs = 30 * 1000, now = () => Date.now() }) {
  const failures = new Map(), tickets = new Map();
  const getClientIp = (req) => String(req.headers["x-forwarded-for"] || req.ip || "unknown").split(",")[0].trim();
  const requireAdmin = (req, res, next) => {
    if (!adminToken) return res.status(500).json({ ok: false, error: "ADMIN_API_TOKEN is not set on backend" });
    const auth = String(req.headers.authorization || ""), bearer = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
    const provided = bearer || String(req.headers["x-admin-token"] || "").trim();
    const streamTicket = req.method === "GET" ? String(req.query?.streamTicket || "").trim() : "";
    const record = streamTicket ? tickets.get(streamTicket) : null, clientIp = getClientIp(req), timestamp = now();
    const validTicket = Boolean(record && record.expiresAt > timestamp && record.ip === clientIp);
    if (validTicket) tickets.delete(streamTicket);
    if (validTicket || provided === adminToken) {
      failures.delete(clientIp);
      return next();
    }
    const failure = failures.get(clientIp);
    if (failure && failure.resetAt > timestamp && failure.count >= failureLimit) {
      return res.status(429).json({ ok: false, error: "Too many authentication failures" });
    }
    const active = failure && failure.resetAt > timestamp ? failure : { count: 0, resetAt: timestamp + failureWindowMs };
    active.count += 1; failures.set(clientIp, active);
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  };
  const registerRoutes = (app) => app.post("/auth/stream-ticket", requireAdmin, (req, res) => {
    const ticket = crypto.randomBytes(32).toString("base64url");
    tickets.set(ticket, { ip: getClientIp(req), expiresAt: now() + ticketTtlMs });
    res.json({ ok: true, ticket, expiresInSeconds: ticketTtlMs / 1000 });
  });
  return { requireAdmin, registerRoutes, getClientIp };
}
