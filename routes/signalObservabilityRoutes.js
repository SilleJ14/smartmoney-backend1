export function registerSignalObservabilityRoutes(app, dependencies) {
  const {
    requireAdmin, getState, buildHighConvictionSummary, buildLiveQuotesPayload,
    getProductionContext, normalizeSymbol, savePendingExits,
    getOpenOrders, now = () => new Date(),
  } = dependencies;
  const fail = (res, error, details, extra = {}) => res.status(500).json({
    ok: false, error, details: details.message, generatedAt: now().toISOString(), ...extra,
  });

  app.get("/high-conviction", requireAdmin, (req, res) => {
    try {
      const limit = Math.min(10, Math.max(3, Number(req.query.limit || 5)));
      res.json({ ok: true, ...buildHighConvictionSummary(limit) });
    } catch (error) { fail(res, "Failed to build high conviction summary", error); }
  });
  app.get("/production-health", requireAdmin, (_req, res) => {
    const state = getState(), context = getProductionContext();
    res.json({
      ok: true, generatedAt: now().toISOString(), mode: context.mode,
      autoTradingEnabled: context.autoTradingEnabled, marketOpen: state.marketOpen,
      activeBuyLocks: context.activeBuyLocks, liveSignalClientCount: context.liveSignalClientCount,
      liveQuoteCount: Object.keys(state.liveQuoteCache || {}).length,
      liveQuoteStreamState: state.liveQuoteStreamState || null, lastScanAt: state.lastScanAt,
      lastSuccessfulCycleAt: state.lastSuccessfulCycleAt, lastError: state.lastError,
      hedgeFundLayer: state.autonomousHedgeFundLayerState || null,
      parliament: state.aiParliamentVotingState || null,
      metaReinforcement: state.autonomousMetaReinforcementState || null,
    });
  });
  app.get("/live-quotes", requireAdmin, (req, res) => {
    try {
      const symbols = String(req.query.symbols || "").split(",").map((item) => item.trim()).filter(Boolean);
      res.json(buildLiveQuotesPayload(symbols));
    } catch (error) { fail(res, "Failed to load live quotes", error); }
  });
  app.get("/live-market-memory", requireAdmin, (req, res) => {
    try {
      const state = getState();
      const symbols = String(req.query.symbols || "").split(",").map((item) => item.trim()).filter(Boolean).map(normalizeSymbol);
      const memory = Object.entries(state.liveMarketMemory || {}).filter(([symbol]) => !symbols.length || symbols.includes(symbol)).map(([symbol, item]) => ({
        symbol, price: Number(item.price || 0), bid: Number(item.bid || 0), ask: Number(item.ask || 0),
        spread: Number(item.spread || 0), spreadPercent: Number(item.spreadPercent || 0),
        fastRunnerScore: Number(item.fastRunnerScore || 0), liveMomentumPercent: Number(item.liveMomentumPercent || 0),
        tapeSpeed: Number(item.tapeSpeed || 0), liquidityPressure: Number(item.liquidityPressure || 0),
        fastRunnerBreakdown: item.fastRunnerBreakdown || null, updatedAt: item.updatedAt || null,
        secondCandles: item.secondCandles?.slice(-60) || [],
      })).sort((a, b) => b.fastRunnerScore - a.fastRunnerScore);
      res.json({ ok: true, generatedAt: now().toISOString(), polygonLiveStreamState: state.polygonLiveStreamState || null,
        liveEarlyMoverSymbols: state.liveEarlyMoverSymbols || [], liveEarlyMoverRefreshState: state.liveEarlyMoverRefreshState || null,
        count: memory.length, memory });
    } catch (error) { fail(res, "Failed to load live market memory", error); }
  });
  app.get("/pending-exits", requireAdmin, async (_req, res) => {
    try {
      const pendingExits = savePendingExits(await getOpenOrders());
      res.json({ ok: true, generatedAt: now().toISOString(), count: pendingExits.length, pendingExits });
    } catch (error) { fail(res, "Failed to load pending exits", error, { fallbackPendingExits: getState().pendingExits || [] }); }
  });
  app.get("/decision-audit", requireAdmin, (req, res) => {
    const state = getState();
    const limit = Math.min(50, Math.max(1, Number(req.query?.limit || 20)));
    const signals = [...(state.lastStockSignals || []), ...(state.lastCryptoSignals || [])]
      .slice(0, limit)
      .map((signal) => ({
        symbol: signal.symbol,
        assetClass: signal.isCrypto ? "crypto" : "stock",
        candidateSource: signal.candidateSource || signal.source || null,
        discoveredBecause: signal.discoveryScorecard || signal.cryptoDiscoveryScorecard || null,
        entryDecision: signal.entryScorecard || signal.entryQuality || null,
        continuationDecision: signal.continuationScorecard || signal.multiDayContinuation || null,
        finalDecision: signal.decisionScoreTelemetry || signal.finalMasterDecision || null,
        sizing: signal.positionSizing || { recommendedTradeAmount: signal.recommendedTradeAmount || 0 },
        executionGate: signal.finalStockExecutionGate || signal.sharedCryptoExecutionGate || null,
        buyBlockReasons: signal.buyBlockReasons || signal.blockReasons || [],
      }));
    res.json({ ok: true, generatedAt: now().toISOString(), signals,
      recentOrderDecisions: (state.recentOrders || []).slice(0, limit),
      rejectedOrderDecisions: (state.failedOrders || []).slice(0, limit),
      pendingExitDecisions: (state.pendingExits || []).slice(0, limit) });
  });
}
