export function resetDailyLocks(state) {
  Object.assign(state, { dailyLossLocked: false, profitLocked: false, dailyStartEquity: null,
    dailyPeakEquity: null, profitLockFloorEquity: null, dailyDateKey: null });
  return state;
}

export function registerOperationalActionRoutes(app, dependencies) {
  const { requireAdmin, getState, runEngineCycle, getAutoTradingEnabled, saveState,
    setModeLock, getControlState, recordOrder, now = () => new Date(), logger = console } = dependencies;
  app.post("/scan-now", requireAdmin, (_req, res) => {
    const state = getState();
    if (state.running) return res.json({ ok: true, message: "Scan already running", running: true,
      lastScanAt: state.lastScanAt, lastTickStartedAt: state.lastTickStartedAt });
    void runEngineCycle().catch((error) => {
      state.lastError = error.message; state.running = false; saveState("MANUAL_SCAN_FAILED");
      logger.error("Manual scan failed:", error.message);
    });
    res.json({ ok: true, message: "Scan started", running: true,
      autoTradingEnabled: getAutoTradingEnabled(), lastScanAt: state.lastScanAt });
  });
  for (const [path, locked] of [["/mode-lock/on", true], ["/mode-lock/off", false]]) {
    app.post(path, requireAdmin, (_req, res) => {
      const state = setModeLock(locked);
      res.json({ message: `Trading mode ${locked ? "locked" : "unlocked"}`, mode: state.mode,
        tradingModeLocked: state.tradingModeLocked, autoTradingEnabled: state.autoTradingEnabled });
    });
  }
  app.post("/reset-daily-lock", requireAdmin, (_req, res) => {
    const state = resetDailyLocks(getState());
    recordOrder("MANUAL_DAILY_LOCK_RESET", "ACCOUNT", { resetAt: now().toISOString() });
    saveState("DAILY_PROFIT_LOCK_RESET");
    res.json({ message: "Daily/profit lock reset", engineState: state });
  });
}
