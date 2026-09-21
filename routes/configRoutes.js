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
    const disabling = updates.autoTradingEnabled === false || updates.autoTradingEnabled === "false";
    const state = controlState();
    if (enabling && state.emergencyStopActive) {
      return { status: 423, error: "Emergency stop is active. Auto trading cannot be enabled." };
    }
    if (disabling && state.emergencyStopActive !== true) {
      return {
        status: 423,
        error: "Autopilot stays on after emergency stop is released. Engage emergency stop to halt new buys.",
      };
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
      const state = controlState();
      const parsed = parseRemoteConfigUpdates(req.body, state.emergencyStopActive);
      if (parsed.error) return res.status(parsed.locked ? 423 : 400).json({ ok: false, error: parsed.error, ...(parsed.received !== undefined ? { received: parsed.received } : {}) });
      const blocked = automationBlock(parsed.updates);
      if (blocked) return res.status(blocked.status).json({ ok: false, error: blocked.error });
      res.json({ ok: true, updatedAt: now().toISOString(), ...applyApiUpdates(parsed.updates, getRuntimeConfig()) });
    } catch (error) { res.status(500).json({ ok: false, error: error.message }); }
  });
}
