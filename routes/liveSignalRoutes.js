export function registerLiveSignalRoutes(app, dependencies) {
  const { requireAdmin, getState, runFastRunnerEngine, getTopSignals, mergeLiveQuote,
    getMarketSession, getMode, getAutoTradingEnabled, buildTopBrains,
    now = () => new Date(), logger = console } = dependencies;
  app.get("/fast-runners", requireAdmin, async (req, res) => {
    try {
      const state = getState(), refresh = String(req.query.refresh || "").toLowerCase() === "true";
      if (refresh || !state.fastRunnerEngineState) await runFastRunnerEngine();
      const current = getState();
      res.json({ ok: true, generatedAt: now().toISOString(), state: current.fastRunnerEngineState || null,
        count: current.fastRunnerCandidates?.length || 0, candidates: current.fastRunnerCandidates || [],
        visibleCandidates: current.visibleLiveCandidates || [] });
    } catch (error) { res.status(500).json({ ok: false, error: "Failed to load fast runners", details: error.message }); }
  });
  app.get("/live-signals", requireAdmin, async (_req, res) => {
    try {
      const state = getState();
      const stockSignals = getTopSignals([...(state.lastStockSignals || []), ...(state.fastRunnerCandidates || []),
        ...(state.quickInstitutionalCandidates || [])], 25).map(mergeLiveQuote);
      const cryptoSignals = getTopSignals(state.lastCryptoSignals || [], 25).map(mergeLiveQuote);
      res.json({ generatedAt: now().toISOString(), marketOpen: Boolean(state.marketOpen),
        marketSession: getMarketSession({ is_open: Boolean(state.marketOpen) }), mode: getMode(),
        effectiveMode: state.effectiveMode, autoTradingEnabled: getAutoTradingEnabled(),
        liveQuoteStreamState: state.liveQuoteStreamState || null, stockSignals, cryptoSignals,
        signalCount: stockSignals.length + cryptoSignals.length });
    } catch (error) {
      logger.error("live-signals error", error);
      res.status(500).json({ error: "Failed to load live signals", details: error.message, generatedAt: now().toISOString() });
    }
  });
  app.get("/top-brains", requireAdmin, (_req, res) => {
    try { const brains = buildTopBrains(); res.json({ ok: true, generatedAt: now().toISOString(), count: brains.length, brains }); }
    catch (error) { res.status(500).json({ ok: false, error: "Failed to load top AI brains", details: error.message }); }
  });
}
