function uniqueSignals(signals, normalizeSymbol) {
  return signals
    .filter(Boolean)
    .filter(
      (signal, index, all) =>
        all.findIndex(
          (item) => normalizeSymbol(item.symbol) === normalizeSymbol(signal.symbol)
        ) === index
    );
}

function collectSignals(state, latestStatus, normalizeSymbol, includeFastRunners = false) {
  const orchestration = latestStatus?.phase20AutonomousOrchestration || {};
  return uniqueSignals(
    [
      ...(Array.isArray(state.topStockSignals) ? state.topStockSignals : []),
      ...(Array.isArray(state.lastStockSignals) ? state.lastStockSignals : []),
      ...(includeFastRunners && Array.isArray(state.fastRunnerCandidates)
        ? state.fastRunnerCandidates
        : []),
      ...(includeFastRunners && Array.isArray(state.quickInstitutionalCandidates)
        ? state.quickInstitutionalCandidates
        : []),
      ...(Array.isArray(state.topCryptoSignals) ? state.topCryptoSignals : []),
      ...(Array.isArray(state.lastCryptoSignals) ? state.lastCryptoSignals : []),
      ...(Array.isArray(orchestration.topSignals) ? orchestration.topSignals : []),
    ],
    normalizeSymbol
  );
}

export function registerFrontendRoutes(app, dependencies) {
  const {
    requireAdmin,
    getState,
    getConfig,
    refreshAccountCache,
    getLatestStatus,
    buildStartupSnapshot,
    normalizeSymbol,
    mergeLiveQuote,
    getTopSignals,
  } = dependencies;

  app.get("/frontend/portfolio", requireAdmin, async (req, res) => {
    try {
      await refreshAccountCache();
      const latestStatus = getLatestStatus();
      const config = getConfig();
      const account = latestStatus?.account || {};
      const risk = latestStatus?.risk || {};
      const dashboard = latestStatus?.institutionalDashboard || {};
      const governor = dashboard?.portfolioGovernor || {};
      const equity = Number(account.equity || risk.currentEquity || 0);
      const cash = Number(account.cash || risk.currentCash || 0);
      const openValue = Number(
        account.position_market_value || risk.currentBotExposure || governor.currentExposure || 0
      );
      const maxBotBudget = Number(governor.maxBudget || risk.maxBotBudget || 0);
      const autoCapLeft = Math.max(0, maxBotBudget - openValue);
      const peakEquity = Number(account.peakEquity || risk.peakEquity || equity);
      const drawdownPercent = peakEquity > 0 ? ((peakEquity - equity) / peakEquity) * 100 : 0;
      const lastEquity = Number(account.last_equity || 0);
      const portfolioReturnPercent =
        lastEquity > 0 ? ((equity - lastEquity) / lastEquity) * 100 : 0;

      res.json({
        success: true,
        portfolio: {
          equity,
          cash,
          openValue,
          maxBotBudget,
          autoCapLeft,
          unrealizedPL: equity - cash,
          realizedPL: 0,
          portfolioReturnPercent,
          drawdownPercent,
          dailyLossLeftPercent: Number(config.dailyLossLimitPercent || 2) - drawdownPercent,
          openPositions: Number(latestStatus?.positions?.length || 0),
          peakEquity,
        },
      });
    } catch (err) {
      console.error("frontend portfolio error", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.get("/frontend/snapshot", requireAdmin, (req, res) => {
    try {
      const limit = Math.min(100, Math.max(10, Number(req.query.limit || 50)));
      res.json({ success: true, ...buildStartupSnapshot(limit) });
    } catch (err) {
      console.error("frontend snapshot error", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.get("/frontend/signals", requireAdmin, async (req, res) => {
    try {
      const signals = collectSignals(
        getState(),
        getLatestStatus(),
        normalizeSymbol,
        true
      ).map(mergeLiveQuote);
      const approvedSignals = signals
        .filter((signal) => signal?.qualifiedToBuy && (signal.autoTradeApproved || signal.approved))
        .sort((a, b) => (b.score || 0) - (a.score || 0));
      const displaySignals = approvedSignals.length
        ? approvedSignals
        : signals.sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
      res.json({
        success: true,
        count: displaySignals.length,
        approvedCount: approvedSignals.length,
        source: approvedSignals.length ? "approved_signals" : "memory_snapshot_fallback",
        signals: displaySignals,
      });
    } catch (err) {
      console.error("frontend signals error", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.get("/frontend/ai", requireAdmin, async (req, res) => {
    try {
      const latestStatus = getLatestStatus();
      const brain = latestStatus?.phase21AutonomousBrain || {};
      const orchestration = latestStatus?.phase20AutonomousOrchestration || {};
      const autonomous = latestStatus?.autonomousTradingSystem || {};
      const governor = latestStatus?.institutionalDashboard?.portfolioGovernor || {};
      res.json({
        success: true,
        ai: {
          brainMode: brain.brainMode,
          autonomousIntelligenceScore: brain.autonomousIntelligenceScore,
          parliamentDecision: autonomous.capitalParliamentDecision,
          probabilityScore: autonomous.probabilityScore,
          consensusScore: orchestration.consensusScore,
          governorMode: governor.governorMode,
          governorScore: governor.governorScore,
          capitalThrottleMultiplier: governor.capitalThrottleMultiplier,
          shouldBlockNewTrades: brain.shouldBlockNewTrades,
          finalSystemReason: autonomous.finalSystemReason,
          governorReason: governor.governorReason,
          topCandidates: brain.topAutonomousCandidates || [],
        },
      });
    } catch (err) {
      console.error("frontend ai error", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.get("/frontend/alerts", requireAdmin, async (req, res) => {
    try {
      const config = getConfig();
      const alerts = collectSignals(getState(), getLatestStatus(), normalizeSymbol)
        .map(mergeLiveQuote)
        .filter((signal) => signal.score >= Number(config.minScoreToBuy || 70))
        .slice(0, 25)
        .map((signal) => ({
          symbol: signal.symbol,
          score: signal.score,
          message:
            signal.portfolioManagerReason ||
            signal.technicalReason ||
            signal.executionReason ||
            "Institutional signal detected",
          approved: signal.autoTradeApproved || signal.approved,
          executionConfidence: signal.executionConfidence || 0,
          institutionalGrade: signal.institutionalGrade || "NORMAL",
        }));
      res.json({ success: true, count: alerts.length, alerts });
    } catch (err) {
      console.error("frontend alerts error", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.get("/frontend/dashboard", requireAdmin, async (req, res) => {
    const state = getState();
    try {
      const latestStatus = getLatestStatus();
      const topSignals = getTopSignals(
        collectSignals(state, latestStatus, normalizeSymbol),
        25
      ).map(mergeLiveQuote);
      res.json({
        success: true,
        dashboard: {
          marketRegime: latestStatus?.institutionalDashboard?.marketRegime || {},
          autonomousTradingSystem: latestStatus?.autonomousTradingSystem || {},
          portfolioGovernor: latestStatus?.institutionalDashboard?.portfolioGovernor || {},
          topSignals,
          topOpportunities: latestStatus?.phase21AutonomousBrain?.topAutonomousCandidates || [],
        },
      });
    } catch (err) {
      console.error("/status route failed:", err.message);
      res.json({
        success: true,
        degradedMode: true,
        dashboard: {
          statusWarnings: [err.message],
          marketRegime: state.marketRegime || {},
          autonomousTradingSystem: state.autonomousTradingSystemState || {},
          portfolioGovernor: state.portfolioGovernorState || {},
          topSignals: [
            ...(Array.isArray(state.topStockSignals) ? state.topStockSignals : []),
            ...(Array.isArray(state.lastStockSignals) ? state.lastStockSignals : []),
            ...(Array.isArray(state.topCryptoSignals) ? state.topCryptoSignals : []),
            ...(Array.isArray(state.lastCryptoSignals) ? state.lastCryptoSignals : []),
          ].slice(0, 10).map(mergeLiveQuote),
          topOpportunities: state.topAutonomousCandidates || [],
        },
      });
    }
  });
}
