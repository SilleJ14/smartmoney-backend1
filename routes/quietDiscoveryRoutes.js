export function registerQuietDiscoveryRoutes(app, { requireAdmin, getState, getStoreStats, runDiscovery }) {
  app.get("/discovery/quiet", requireAdmin, (_req, res) => {
    res.json({ ok: true, state: getState().boundedQuietDiscoveryState || null, store: getStoreStats() });
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
