import { parseRemoteConfigUpdates } from "../config/remoteConfigUpdates.js";

export function registerConfigRoutes(app, dependencies) {
  const { requireAdmin, getConfig, getRuntimeConfig, isEmergencyStopped, getControlState, resetRuntimeConfig,
    applyPermanentUpdates, applyApiUpdates, now = () => new Date() } = dependencies;
  const controlState = () => getControlState?.() || {
    emergencyStopActive: Boolean(isEmergencyStopped?.()),
    dailyLossLocked: false,
    profitLocked: false,
  };
  const automationBlock = (updates = {}) => {
    const enabling = updates.autoTradingEnabled === true || updates.autoTradingEnabled === "true";
    if (!enabling) return null;
    const state = controlState();
    if (state.emergencyStopActive) {
      return { status: 423, error: "Emergency stop is active. Auto trading cannot be enabled." };
    }
    if (state.dailyLossLocked) {
      return { status: 403, error: "Auto trading is locked because the daily loss limit was reached." };
    }
    if (state.profitLocked) {
      return { status: 403, error: "Auto trading is locked because the profit lock was reached." };
    }
    return null;
  };
  app.post("/reset-runtime-config", requireAdmin, (_req, res) => {
    try { resetRuntimeConfig(); res.json({ success: true, message: "runtime-config.json deleted successfully. Restart backend now." }); }
    catch (error) { res.status(500).json({ success: false, error: error.message }); }
  });
  app.get("/config", requireAdmin, (_req, res) => res.json({ message: "Current remote config", config: getConfig() }));
  app.post("/config", requireAdmin, (req, res) => {
    const state = controlState();
    const parsed = parseRemoteConfigUpdates(req.body, state.emergencyStopActive);
    if (parsed.error) return res.status(parsed.locked ? 423 : 400).json({ ok: false, error: parsed.error, ...(parsed.received !== undefined ? { received: parsed.received } : {}) });
    const blocked = automationBlock(parsed.updates);
    if (blocked) return res.status(blocked.status).json({ ok: false, error: blocked.error });
    try { res.json(applyPermanentUpdates(parsed.updates)); }
    catch (error) { res.status(500).json({ ok: false, error: error.message }); }
  });
  app.post("/api/config", requireAdmin, (req, res) => {
    try {
      const updates = req.body || {};
      const blocked = automationBlock(updates);
      if (blocked) return res.status(blocked.status).json({ ok: false, error: blocked.error });
      res.json({ ok: true, updatedAt: now().toISOString(), ...applyApiUpdates(updates, getRuntimeConfig()) });
    } catch (error) { res.status(500).json({ ok: false, error: error.message }); }
  });
}
