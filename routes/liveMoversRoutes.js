import { buildLiveMovers } from "../market-data/liveMovers.js";

export function registerLiveMoversRoutes(app, dependencies) {
  const {
    requireAdmin,
    getState,
    normalizeSymbol,
    mergeLiveQuote,
    isCrypto,
    getRuntimeStatus,
  } = dependencies;

  app.get("/live-movers", requireAdmin, (req, res) => {
    try {
      const state = getState();
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
        ...runtime,
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
