import { parseRemoteConfigUpdates } from "../config/remoteConfigUpdates.js";

export function registerConfigRoutes(app, dependencies) {
  const { requireAdmin, getConfig, getRuntimeConfig, isEmergencyStopped, resetRuntimeConfig,
    applyPermanentUpdates, applyApiUpdates, now = () => new Date() } = dependencies;
  app.post("/reset-runtime-config", requireAdmin, (_req, res) => {
    try { resetRuntimeConfig(); res.json({ success: true, message: "runtime-config.json deleted successfully. Restart backend now." }); }
    catch (error) { res.status(500).json({ success: false, error: error.message }); }
  });
  app.get("/config", requireAdmin, (_req, res) => res.json({ message: "Current remote config", config: getConfig() }));
  app.post("/config", requireAdmin, (req, res) => {
    const parsed = parseRemoteConfigUpdates(req.body, isEmergencyStopped());
    if (parsed.error) return res.status(parsed.locked ? 423 : 400).json({ ok: false, error: parsed.error, ...(parsed.received !== undefined ? { received: parsed.received } : {}) });
    try { res.json(applyPermanentUpdates(parsed.updates)); }
    catch (error) { res.status(500).json({ ok: false, error: error.message }); }
  });
  app.post("/api/config", requireAdmin, (req, res) => {
    try {
      const updates = req.body || {};
      if (isEmergencyStopped() && (updates.autoTradingEnabled === true || updates.autoTradingEnabled === "true")) {
        return res.status(423).json({ ok: false, error: "Emergency stop is active. Auto trading cannot be enabled." });
      }
      res.json({ ok: true, updatedAt: now().toISOString(), ...applyApiUpdates(updates, getRuntimeConfig()) });
    } catch (error) { res.status(500).json({ ok: false, error: error.message }); }
  });
}
