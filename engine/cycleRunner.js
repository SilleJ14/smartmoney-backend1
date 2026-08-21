export function createCycleRunner({ state, saveState, now = () => Date.now(), onError = console.error }) {
  async function run(worker) {
    if (state.running) return { ran: false, reason: "already_running" };
    state.running = true;
    state.engineFreezeDetected = false;
    state.lastHeartbeatAt = new Date(now()).toISOString();
    state.totalEngineTicks = Number(state.totalEngineTicks || 0) + 1;
    state.lastTickStartedAt = now();
    state.lastError = null;
    let completedWithoutError = false;
    try {
      await worker();
      completedWithoutError = true;
      return { ran: true, reason: "completed" };
    } catch (error) {
      state.lastError = error.message;
      state.scanFailureCount = Number(state.scanFailureCount || 0) + 1;
      state.selfHealingScanState = {
        updatedAt: new Date(now()).toISOString(),
        recoveryAction: "SCAN_ERROR_RECORDED",
        recovered: false,
        error: error.message,
        scanFailureCount: state.scanFailureCount,
      };
      state.selfHealingScanHistory = [
        state.selfHealingScanState,
        ...(state.selfHealingScanHistory || []),
      ].slice(0, 200);
      state.lastEngineStopReason = "ENGINE_ERROR";
      onError(error);
      return { ran: true, reason: "failed", error };
    } finally {
      state.lastTickDurationMs = now() - state.lastTickStartedAt;
      if (completedWithoutError) state.lastEngineStopReason = "ENGINE_TICK_COMPLETED";
      state.engineFreezeDetected = false;
      saveState(completedWithoutError ? "ENGINE_TICK_COMPLETED" : "ENGINE_ERROR");
      state.running = false;
    }
  }
  return { run };
}
