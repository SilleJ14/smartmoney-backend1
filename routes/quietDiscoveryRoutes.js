export function registerQuietDiscoveryRoutes(app, { requireAdmin, getState, getStoreStats, runDiscovery }) {
  app.get("/discovery/quiet", requireAdmin, (_req, res) => {
    const state = getState();
    res.json({
      ok: true,
      state: state.boundedQuietDiscoveryState || null,
      cryptoState: state.cryptoQuietDiscoveryState || null,
      learning: state.quietCandidateOutcomeLearning || null,
      store: getStoreStats(),
    });
  });
  app.get("/discovery/quiet/outcomes", requireAdmin, (req, res) => {
    const state = getState();
    const outcomeState = state.quietCandidateOutcomeState || {};
    const limit = Math.min(100, Math.max(1, Number(req.query?.limit || 50)));
    const assetClass = String(req.query?.assetClass || "").toLowerCase();
    const observations = (outcomeState.observations || [])
      .filter((item) => !assetClass || item.assetClass === assetClass)
      .slice(0, limit);
    res.json({
      ok: true,
      updatedAt: outcomeState.updatedAt || null,
      observationCount: Number(outcomeState.observationCount || 0),
      learning: state.quietCandidateOutcomeLearning || outcomeState.learning || null,
      returnedCount: observations.length,
      observations,
    });
  });
  app.post("/discovery/quiet/run", requireAdmin, async (_req, res) => {
    try {
      const state = await runDiscovery({ force: true });
      res.json({ ok: state?.ok === true, state, store: getStoreStats() });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message, store: getStoreStats() });
    }
  });
}
