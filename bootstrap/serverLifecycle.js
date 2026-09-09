export function startServerLifecycle(options) {
  const {
    app, port, processRef = process, state, config, runStartupScan,
    saveState, flushState, saveRenderMemory, checkRunnerResults,
    startServices = [], runStartupEngineScan = false,
    setIntervalFn = setInterval, setTimeoutFn = setTimeout, logger = console,
  } = options;
  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    saveState(`SHUTDOWN_${signal}`);
    if (typeof flushState === "function") await flushState();
    else saveState("SHUTDOWN");
    processRef.exit(0);
  };
  processRef.on("SIGINT", () => void shutdown("SIGINT"));
  processRef.on("SIGTERM", () => void shutdown("SIGTERM"));
  setIntervalFn(() => {
    try { saveRenderMemory("RENDER_MEMORY_INTERVAL"); saveState("RENDER_MEMORY_INTERVAL"); }
    catch (error) { logger.error("RENDER_MEMORY_INTERVAL", error?.message); }
  }, 300000);
  setIntervalFn(() => void checkRunnerResults().catch((error) =>
    logger.error("RUNNER_RESULT_CHECKER_INTERVAL", error?.message)), 60 * 60 * 1000);
  return app.listen(port, "0.0.0.0", async () => {
    logger.log(`SmartMoney Pro backend running on port ${port}`);
    startServices.forEach((start) => start());
    logger.log(`Auto trading enabled: ${options.autoTradingEnabled}`);
    if (!runStartupEngineScan || state.running || state.engineFreezeDetected) return;
    setTimeoutFn(() => void runStartupScan().then(() => {
      state.startupScanState = { ok: true, completedAt: new Date().toISOString() };
      saveState("STARTUP_SCAN_COMPLETED");
    }).catch((error) => {
      state.running = false; state.lastError = error.message;
      state.lastEngineStopReason = "STARTUP_ENGINE_TICK_FAILED";
      state.startupScanState = { ok: false, failedAt: new Date().toISOString(), error: error.message };
      saveState("STARTUP_SCAN_FAILED"); logger.error("Startup runEngineCycle failed:", error.message);
    }), 3000);
  });
}
