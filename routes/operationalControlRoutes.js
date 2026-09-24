export const RELEASE_CONFIRMATION = "RELEASE EMERGENCY STOP";
export const RESET_DAILY_LOSS_CONFIRMATION = "RESET DAILY LOSS LOCK";

export function registerOperationalControlRoutes(app, dependencies) {
  const {
    requireAdmin, getControlState, updateControlState,
    recordOrder, getClientIp, saveEngineState, resetDailyLossLock,
  } = dependencies;

  app.post("/emergency-stop", requireAdmin, (req, res) => {
    const state = updateControlState({ emergencyStopActive: true, autoTradingEnabled: false });
    recordOrder("EMERGENCY_STOP_ENGAGED", "ACCOUNT", {
      ip: getClientIp(req), engagedAt: new Date().toISOString(),
    });
    saveEngineState("EMERGENCY_STOP_ENGAGED");
    res.json({
      ok: true,
      emergencyStopActive: state.emergencyStopActive,
      autoTradingEnabled: state.autoTradingEnabled,
      message: "Emergency stop engaged. New buy orders are blocked; exits remain available.",
    });
  });

  app.post("/emergency-stop/release", requireAdmin, (req, res) => {
    if (String(req.body?.confirmation || "") !== RELEASE_CONFIRMATION) {
      return res.status(400).json({
        ok: false,
        error: `Exact confirmation phrase required: ${RELEASE_CONFIRMATION}`,
      });
    }
    const state = updateControlState({ emergencyStopActive: false, autoTradingEnabled: true });
    recordOrder("EMERGENCY_STOP_RELEASED", "ACCOUNT", {
      ip: getClientIp(req), releasedAt: new Date().toISOString(),
    });
    saveEngineState("EMERGENCY_STOP_RELEASED");
    res.json({
      ok: true,
      emergencyStopActive: state.emergencyStopActive,
      autoTradingEnabled: state.autoTradingEnabled,
      message: "Emergency stop released. Autopilot stays armed on the server until emergency stop is engaged again.",
    });
  });

  app.post("/daily-loss-lock/reset", requireAdmin, (req, res) => {
    if (String(req.body?.confirmation || "") !== RESET_DAILY_LOSS_CONFIRMATION) {
      return res.status(400).json({
        ok: false,
        error: `Exact confirmation phrase required: ${RESET_DAILY_LOSS_CONFIRMATION}`,
      });
    }
    const result = typeof resetDailyLossLock === "function"
      ? resetDailyLossLock()
      : { dailyLossLocked: false };
    recordOrder("DAILY_LOSS_LOCK_RESET", "ACCOUNT", {
      ip: getClientIp(req),
      resetAt: new Date().toISOString(),
      dailyStartEquity: result?.dailyStartEquity,
    });
    saveEngineState("DAILY_LOSS_LOCK_RESET");
    const state = getControlState();
    res.json({
      ok: true,
      dailyLossLocked: state.dailyLossLocked === true,
      autoTradingEnabled: state.autoTradingEnabled,
      emergencyStopActive: state.emergencyStopActive,
      dailyStartEquity: result?.dailyStartEquity,
      message: "Daily loss lock cleared. The daily loss clock now starts from current equity. Autopilot and emergency stop are unchanged.",
    });
  });

  app.post("/auto-trading/on", requireAdmin, (req, res) => {
    const state = getControlState();
    if (state.emergencyStopActive) {
      return res.status(423).json({
        ok: false,
        message: "Emergency stop is active. Release it before enabling auto trading.",
      });
    }
    const nextState = updateControlState({ autoTradingEnabled: true });
    saveEngineState("AUTO_TRADING_ENABLED");
    res.json({ message: "Auto trading enabled", autoTradingEnabled: nextState.autoTradingEnabled });
  });

  app.post("/auto-trading/off", requireAdmin, (_req, res) => {
    res.status(423).json({
      ok: false,
      autoTradingEnabled: getControlState().autoTradingEnabled,
      error: "Autopilot stays on after emergency stop is released. Engage emergency stop to halt new buys.",
    });
  });

  app.post("/forex-auto/on", requireAdmin, (_req, res) => {
    if (getControlState().forexSettingsSaving === true) {
      return res.status(409).json({ ok: false, error: "Forex settings are saving. Try again afterward." });
    }
    if (getControlState().forexDailyLossLocked === true) {
      return res.status(423).json({ ok: false, error: "Reset the forex daily-loss lock first." });
    }
    if (getControlState().forexEmergencyStopActive === true) {
      return res.status(423).json({ ok: false, error: "Release the forex emergency stop first." });
    }
    const nextState = updateControlState({ forexAutoEnabled: true });
    saveEngineState("FOREX_AUTO_ENABLED");
    res.json({
      ok: true,
      message: "Forex Autopilot enabled",
      forexAutoEnabled: nextState.forexAutoEnabled === true,
      autoTradingEnabled: nextState.autoTradingEnabled,
    });
  });

  app.post("/forex-auto/off", requireAdmin, (_req, res) => {
    const nextState = updateControlState({ forexAutoEnabled: false });
    saveEngineState("FOREX_AUTO_DISABLED");
    res.json({
      ok: true,
      message: "Forex Autopilot paused",
      forexAutoEnabled: nextState.forexAutoEnabled === true,
      autoTradingEnabled: nextState.autoTradingEnabled,
    });
  });

  app.post("/forex-settings", requireAdmin, async (req, res) => {
    try {
      if (!dependencies.saveForexSettings) throw new Error("Forex settings unavailable");
      const state = await dependencies.saveForexSettings(req.body);
      res.json({ ok: true, ...state });
    } catch (error) { res.status(409).json({ ok: false, error: error.message }); }
  });

  app.post("/forex-emergency-stop", requireAdmin, (_req, res) => {
    const state = updateControlState({ forexEmergencyStopActive: true, forexAutoEnabled: false });
    saveEngineState("FOREX_EMERGENCY_STOP_ENGAGED");
    res.json({ ok: true, forexEmergencyStopActive: true, forexAutoEnabled: state.forexAutoEnabled,
      message: "Forex entries stopped. Forex protection and exits remain available. Stocks/crypto unchanged." });
  });
  app.post("/forex-emergency-stop/release", requireAdmin, (req, res) => {
    if (req.body?.confirmation !== "RELEASE FOREX EMERGENCY STOP") {
      return res.status(400).json({ ok: false, error: "Exact confirmation phrase required: RELEASE FOREX EMERGENCY STOP" });
    }
    const state = updateControlState({ forexEmergencyStopActive: false });
    saveEngineState("FOREX_EMERGENCY_STOP_RELEASED");
    res.json({ ok: true, forexEmergencyStopActive: false, forexAutoEnabled: state.forexAutoEnabled,
      message: "Forex stop released. Enable Forex Autopilot separately. Stocks/crypto unchanged." });
  });

  app.post("/forex-entries/pause", requireAdmin, (req, res) => {
    const nextState = updateControlState({ forexPauseEntries: true });
    saveEngineState("FOREX_ENTRIES_PAUSED");
    res.json({
      ok: true,
      message: "Forex new entries paused. Existing protection is unchanged.",
      forexPauseEntries: nextState.forexPauseEntries === true,
      forexAutoEnabled: nextState.forexAutoEnabled === true,
      autoTradingEnabled: nextState.autoTradingEnabled,
    });
  });

  app.post("/forex-entries/resume", requireAdmin, (req, res) => {
    if (String(req.body?.confirmation || "") !== "RESUME FOREX ENTRIES") {
      return res.status(400).json({ ok: false, error: "Exact confirmation phrase required: RESUME FOREX ENTRIES" });
    }
    const nextState = updateControlState({ forexPauseEntries: false });
    saveEngineState("FOREX_ENTRIES_RESUMED");
    res.json({
      ok: true,
      message: "Forex entry pause cleared. Execution still requires safety checks.",
      forexPauseEntries: nextState.forexPauseEntries === true,
      forexAutoEnabled: nextState.forexAutoEnabled === true,
    });
  });

  app.post("/forex-credentials", requireAdmin, (req, res) => {
    const nextState = updateControlState({
      oandaAccountId: String(req.body?.accountId || req.body?.oandaAccountId || "").trim(),
      oandaPracticeToken: String(req.body?.token || req.body?.oandaPracticeToken || "").trim(),
    });
    saveEngineState("FOREX_CREDENTIALS_UPDATED");
    res.json({
      ok: true,
      message: "OANDA practice credentials stored on the server. Autopilot is unchanged.",
      forexAutoEnabled: nextState.forexAutoEnabled === true,
      autoTradingEnabled: nextState.autoTradingEnabled,
      hasAccount: Boolean(nextState),
    });
  });
}
