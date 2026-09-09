// Subscription maintenance must finish or report a handled failure before the
// cycle moves on. It does not revoke the completed scan or alter trading mode.
export async function refreshCycleSubscriptions({
  refresh, engineState, logger = console, now = Date.now,
}) {
  const record = (status) => {
    engineState.liveEarlyMoverRefreshState = {
      ...(engineState.liveEarlyMoverRefreshState || {}),
      cycleSubscriptionRefresh: status,
    };
    return status;
  };
  try {
    const result = await refresh();
    // A successful subscription refresh is not evidence that discovery ran.
    // Keep its completion time separate from the provider's discovery state.
    return record({
      ok: result?.ok !== false,
      updatedAt: new Date(now()).toISOString(),
      error: null,
      errorType: null,
      reason: result?.ok === false
        ? 'Cycle subscription refresh reported unavailable.'
        : 'Cycle subscription refresh completed.',
    });
  } catch (error) {
    const errorType = error instanceof Error ? String(error.name).slice(0, 64) : 'Error';
    const state = {
      ok: false,
      updatedAt: new Date(now()).toISOString(),
      error: 'LIVE_SUBSCRIPTION_REFRESH_FAILED',
      errorType,
      reason: 'Subscription refresh failed; completed scan retained. Refresh will retry on the next cycle.',
    };
    // Do not include raw provider errors (which can contain URLs or tokens).
    try { logger.warn?.('LIVE_SUBSCRIPTION_REFRESH_FAILED', { errorType }); } catch {}
    return record(state);
  }
}
