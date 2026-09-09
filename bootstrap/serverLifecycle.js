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
    state.serviceStartupErrors = {};
    // A failed feed must not reject the async listen callback and terminate
    // Node, nor prevent the other providers and scanner from starting.
    startServices.forEach((start, index) => {
      const failed = (error) => {
        const name = start.name || `service_${index}`;
        state.serviceStartupErrors[name] = { error: String(error?.message || error).slice(0, 240),
          failedAt: new Date().toISOString() };
        logger.error(`SERVICE_START_FAILED ${name}`, error?.message);
      };
      try { void Promise.resolve(start()).catch(failed); }
      catch (error) { failed(error); }
    });
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
