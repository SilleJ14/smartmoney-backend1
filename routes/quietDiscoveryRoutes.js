export function registerQuietDiscoveryRoutes(app, {
  requireAdmin,
  getState,
  getStoreStats,
  runDiscovery,
  summarizeQuietCandidateOutcomes = () => null,
  buildProofReport = () => null,
}) {
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
  app.get("/discovery/quiet/proof", requireAdmin, (_req, res) => {
    const state = getState();
    res.json({
      ok: true,
      proof: summarizeQuietCandidateOutcomes(
        state.quietCandidateOutcomeState,
        {
          learning: state.quietCandidateOutcomeLearning,
          stockDiscoveryState: state.boundedQuietDiscoveryState,
          cryptoDiscoveryState: state.cryptoQuietDiscoveryState,
        }
      ),
    });
  });
  app.get("/discovery/quiet/proof/advanced", requireAdmin, (req, res) => {
    const state = getState();
    const feePercent = Math.max(0, Math.min(5, Number(req.query?.feePercent ?? 0.15)));
    const slippagePercent = Math.max(0, Math.min(5, Number(req.query?.slippagePercent ?? 0.1)));
    res.json({ ok: true, proof: buildProofReport(state.quietCandidateOutcomeState, { feePercent, slippagePercent }) });
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
