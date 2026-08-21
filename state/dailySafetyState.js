export function resetDailySafetyState(state, { todayKey, equity }) {
  const normalizedEquity = Number(equity || 0);
  if (!normalizedEquity || normalizedEquity <= 0 || state.dailyDateKey === todayKey) {
    return { reset: false, state };
  }
  Object.assign(state, {
    dailyDateKey: todayKey,
    dailyStartEquity: normalizedEquity,
    dailyPeakEquity: normalizedEquity,
    profitLockFloorEquity: null,
    dailyLossLocked: false,
    profitLocked: false,
  });
  return { reset: true, state };
}
