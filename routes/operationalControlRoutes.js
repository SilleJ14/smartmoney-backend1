export const RELEASE_CONFIRMATION = "RELEASE EMERGENCY STOP";

export function registerOperationalControlRoutes(app, dependencies) {
  const {
    requireAdmin, getControlState, updateControlState,
    recordOrder, getClientIp, saveEngineState,
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
}
