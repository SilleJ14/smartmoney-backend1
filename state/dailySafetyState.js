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

export function recordTradingModeWithoutResettingSafety(state, nextMode) {
  const previousMode = state.lastMode || null;
  state.lastMode = nextMode || null;
  return {
    changed: previousMode !== state.lastMode,
    previousMode,
    nextMode: state.lastMode,
    dailyStartEquity: state.dailyStartEquity,
    dailyPeakEquity: state.dailyPeakEquity,
    profitLockFloorEquity: state.profitLockFloorEquity,
    dailyLossLocked: state.dailyLossLocked === true,
    profitLocked: state.profitLocked === true,
  };
}
