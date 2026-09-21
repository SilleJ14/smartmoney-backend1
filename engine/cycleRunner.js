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
      const message = error?.message || 'UNKNOWN_SCAN_ERROR';
      const transient = Number(error?.status) === 429 || /rate limit/i.test(String(message));
      state.lastError = transient ? null : message;
      report({ stage: 'SCAN_FAILED', cycle: String(state.totalEngineTicks), reason: transient ? 'RATE_LIMIT' : 'ENGINE_ERROR' });
      state.scanFailureCount = Number(state.scanFailureCount || 0) + 1;
      state.selfHealingScanState = {
        updatedAt: new Date(now()).toISOString(),
        recoveryAction: transient ? "SCAN_RATE_LIMIT_RECOVERED" : "SCAN_ERROR_RECORDED",
        recovered: transient,
        error: message,
        scanFailureCount: state.scanFailureCount,
      };
      state.selfHealingScanHistory = [
        state.selfHealingScanState,
        ...(state.selfHealingScanHistory || []),
      ].slice(0, 200);
      state.lastEngineStopReason = transient ? "SCAN_RATE_LIMIT_RECOVERED" : "ENGINE_ERROR";
      onError(error);
      return { ran: true, reason: transient ? "rate_limited" : "failed", error };
    } finally {
      state.lastTickDurationMs = now() - state.lastTickStartedAt;
      if (completedWithoutError) state.lastEngineStopReason = "ENGINE_TICK_COMPLETED";
      state.engineFreezeDetected = false;
      try {
        await saveState(completedWithoutError ? "ENGINE_TICK_COMPLETED" : state.lastEngineStopReason || "ENGINE_ERROR");
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
