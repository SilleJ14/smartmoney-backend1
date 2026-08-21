const ENGINES = [
  ["/deep-intelligence-sync", "deepIntelligenceSyncState", "deepIntelligenceSyncHistory", "deepIntelligenceSync", "deep intelligence sync"],
  ["/full-brain-fast-sync", "fullBrainFastSyncState", "fullBrainFastSyncHistory", "fullBrainFastSync", "full brain fast sync"],
  ["/live-scale-in", "liveScaleInState", "liveScaleInHistory", "liveScaleIn", "live scale-in engine"],
  ["/live-position-management", "livePositionManagementState", "livePositionManagementHistory", "livePositionManagement", "live position management"],
  ["/live-starter-buy-gate", "liveStarterBuyGateState", "liveStarterBuyHistory", "liveStarterBuy", "live starter buy gate"],
];

export function registerLiveEngineRoutes(app, { requireAdmin, getState, flags, now = () => new Date() }) {
  for (const [path, stateKey, historyKey, flagKey, label] of ENGINES) {
    app.get(path, requireAdmin, (_req, res) => {
      try {
        const state = getState();
        res.json({ ok: true, generatedAt: now().toISOString(), enabled: flags[flagKey], state: state[stateKey] || null, history: (state[historyKey] || []).slice(0, 25) });
      } catch (error) { res.status(500).json({ ok: false, error: `Failed to load ${label}`, details: error.message }); }
    });
  }
  app.get("/quick-institutional-gate", requireAdmin, (_req, res) => {
    try {
      const state = getState(), candidates = state.quickInstitutionalCandidates || [];
      res.json({ ok: true, generatedAt: now().toISOString(), state: state.quickInstitutionalGateState || null, count: candidates.length, candidates });
    } catch (error) { res.status(500).json({ ok: false, error: "Failed to load quick institutional gate", details: error.message }); }
  });
}
