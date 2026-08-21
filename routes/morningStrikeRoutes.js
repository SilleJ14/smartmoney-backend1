export function buildMorningStrikeSnapshot(state, config, windows) {
  const trades = Number(state.morningTradesToday || 0), limit = Number(config.maxMorningTradesPerDay || 10);
  return { ok: true, premarketMomentumState: state.premarketMomentumState || null,
    morningStrikeState: state.morningStrikeState || null, continuationHoldState: state.continuationHoldState || null,
    explosiveRunnerState: state.explosiveRunnerState || null,
    activeContinuationHoldSymbol: state.activeContinuationHoldSymbol || null,
    morningTradeLimit: { morningTradesToday: trades, maxMorningTradesPerDay: config.maxMorningTradesPerDay,
      remainingMorningTrades: Math.max(0, limit - trades), lastMorningTradeDateKey: state.lastMorningTradeDateKey || null },
    windows, premarketMomentumHistory: (state.premarketMomentumHistory || []).slice(0, 20),
    morningStrikeHistory: (state.morningStrikeHistory || []).slice(0, 20),
    explosiveRunnerHistory: (state.explosiveRunnerHistory || []).slice(0, 20),
    continuationHoldHistory: (state.continuationHoldHistory || []).slice(0, 20) };
}

export function registerMorningStrikeRoutes(app, dependencies) {
  const { requireAdmin, resetCounter, getState, getConfig, getWindows } = dependencies;
  app.get("/morning-strike", requireAdmin, (_req, res) => {
    try { resetCounter(); res.json(buildMorningStrikeSnapshot(getState(), getConfig(), getWindows())); }
    catch (error) { res.status(500).json({ ok: false, error: error.message }); }
  });
}
