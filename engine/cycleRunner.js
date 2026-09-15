export function createCycleRunner({ state, saveState, now = () => Date.now(), onError = console.error, onScanEvent = () => {} }) {
  // Diagnostic failures must never prevent trading-state cleanup.
  const report = event => { try { onScanEvent(event); } catch { /* best effort */ } };
  async function run(worker) {
    if (state.running) {
      report({ stage: 'SCAN_SKIPPED', reason: 'already_running' });
      return { ran: false, reason: "already_running" };
    }
    state.running = true;
    state.engineFreezeDetected = false;
    state.lastHeartbeatAt = new Date(now()).toISOString();
    state.totalEngineTicks = Number(state.totalEngineTicks || 0) + 1;
    state.lastTickStartedAt = now();
    state.lastError = null;
    report({ stage: 'SCAN_STARTED', cycle: String(state.totalEngineTicks) });
    let completedWithoutError = false;
    try {
      await worker();
      completedWithoutError = true;
      return { ran: true, reason: "completed" };
    } catch (error) {
      state.lastError = error?.message || 'UNKNOWN_SCAN_ERROR';
      report({ stage: 'SCAN_FAILED', cycle: String(state.totalEngineTicks), reason: 'ENGINE_ERROR' });
      state.scanFailureCount = Number(state.scanFailureCount || 0) + 1;
      state.selfHealingScanState = {
        updatedAt: new Date(now()).toISOString(),
        recoveryAction: "SCAN_ERROR_RECORDED",
        recovered: false,
        error: state.lastError,
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
      try {
        await saveState(completedWithoutError ? "ENGINE_TICK_COMPLETED" : "ENGINE_ERROR");
        if (completedWithoutError) report({ stage: 'SCAN_COMPLETED', cycle: String(state.totalEngineTicks), durationMs: state.lastTickDurationMs });
      } catch (error) {
        report({ stage: 'SCAN_PERSISTENCE_FAILED', cycle: String(state.totalEngineTicks), reason: 'STATE_SAVE_FAILED' });
        throw error;
      } finally {
        state.running = false;
      }
    }
  }
  return { run };
}
