import { buildLiveMovers } from "../market-data/liveMovers.js";

export function registerLiveMoversRoutes(app, dependencies) {
  const {
    requireAdmin,
    getState,
    normalizeSymbol,
    mergeLiveQuote,
    isCrypto,
    refreshQuotes,
    getRuntimeStatus,
  } = dependencies;

  app.get("/live-movers", requireAdmin, async (req, res) => {
    try {
      const state = getState();
      let activeQuoteRefresh = null;
      if (String(req.query.refresh || "").toLowerCase() === "true" && typeof refreshQuotes === "function") {
        const refreshCandidates = buildLiveMovers({
          state,
          limit: 100,
          normalizeSymbol,
          mergeLiveQuote,
          isCrypto,
        }).sort((a, b) => {
          const approvalGap = Number(b.qualifiedToBuy === true) - Number(a.qualifiedToBuy === true);
          if (approvalGap !== 0) return approvalGap;
          return Number(b.score || 0) - Number(a.score || 0);
        });
        activeQuoteRefresh = await refreshQuotes(
          refreshCandidates.map((candidate) => candidate.symbol)
        );
      }
      const movers = buildLiveMovers({
        state,
        limit: req.query.limit,
        normalizeSymbol,
        mergeLiveQuote,
        isCrypto,
      });
      const runtime = getRuntimeStatus();
      res.json({
        ok: true,
        source: "live_movers_lightweight",
        generatedAt: new Date().toISOString(),
        count: movers.length,
        movers,
        signals: movers,
        stockSignals: movers.filter((signal) => !isCrypto(signal.symbol)),
        cryptoSignals: movers.filter((signal) => isCrypto(signal.symbol)),
        activeQuoteRefresh,
        ...runtime,
        marketOpen: state.marketOpen === true,
        marketSession: state.marketSession || null,
        effectiveMode: state.effectiveMode,
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: "Failed to load live movers",
        details: err.message,
        generatedAt: new Date().toISOString(),
      });
    }
  });
}
