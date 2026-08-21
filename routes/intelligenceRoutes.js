const ROUTES = {
  "/probability-reinforcement": ["probabilityReinforcementState", "probabilityReinforcementHistory"],
  "/institutional-orchestrator": ["institutionalOrchestratorState", "institutionalOrchestratorHistory"],
  "/dcf-valuation": ["dcfValuationState", "dcfValuationHistory"],
  "/competitive-advantage": ["competitiveAdvantageState", "competitiveAdvantageHistory"],
  "/earnings-intelligence": ["earningsIntelligenceState", "earningsIntelligenceHistory"],
  "/portfolio-optimizer": ["portfolioOptimizationState", "portfolioOptimizationHistory"],
  "/technical-intelligence": ["technicalIntelligenceState", "technicalIntelligenceHistory"],
  "/statistical-edge": ["statisticalEdgeState", "statisticalEdgeHistory"],
};

export function buildIntelligenceSnapshot(state, stateKey, historyKey) {
  return { ok: true, [stateKey]: state[stateKey] || null, [historyKey]: (state[historyKey] || []).slice(0, 100) };
}

export function registerIntelligenceRoutes(app, { requireAdmin, getState }) {
  for (const [path, [stateKey, historyKey]] of Object.entries(ROUTES)) {
    app.get(path, requireAdmin, (_req, res) => {
      try { res.json(buildIntelligenceSnapshot(getState(), stateKey, historyKey)); }
      catch (error) { res.status(500).json({ ok: false, error: error.message }); }
    });
  }
  app.get("/capital-compounding", requireAdmin, (_req, res) => {
    try {
      const state = getState();
      res.json({
        ok: true, capitalCompoundingState: state.capitalCompoundingState || null,
        equityCurveState: state.equityCurveState || null,
        drawdownRecoveryState: state.drawdownRecoveryState || null,
        adaptiveRiskState: state.adaptiveRiskState || null,
        capitalCompoundingHistory: (state.capitalCompoundingHistory || []).slice(0, 100),
      });
    } catch (error) { res.status(500).json({ ok: false, error: error.message }); }
  });
}
