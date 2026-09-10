import { candidateFeedDecision } from '../discovery/candidateFeedPolicy.js';

export function registerSignalRoutes(app, dependencies) {
  const { requireAdmin, getState, getMode, mergeLiveQuote, scanCrypto, buildDashboard, initializeJournal } = dependencies;
  app.get("/institutional-dashboard", requireAdmin, (_req, res) => {
    try { res.json({ success: true, dashboard: buildDashboard() }); }
    catch (error) { res.status(500).json({ success: false, error: error.message }); }
  });
  app.get("/signals", requireAdmin, (_req, res) => {
    const state = getState();
    res.json({ lastScanAt: state.lastScanAt, signals: (state.lastSignals || []).map(mergeLiveQuote).filter(signal => candidateFeedDecision(signal).visible), skippedSymbols: state.skippedSymbols });
  });
  app.get("/crypto-signals", requireAdmin, async (_req, res) => {
    try {
      const mode = getMode();
      res.json({ mode, liveOnly: true, signals: (await scanCrypto() || []).map(mergeLiveQuote) });
    } catch (error) { res.status(500).json({ error: error.message }); }
  });
  app.get("/trade-journal", requireAdmin, (_req, res) => {
    try {
      initializeJournal(); const state = getState();
      res.json({ ok: true, tradeJournalState: state.tradeJournalState, openEntries: state.tradeJournalOpenEntries,
        recentClosedTrades: (state.tradeJournalHistory || []).slice(0, 100), strategyPerformanceState: state.strategyPerformanceState,
        regimePerformanceState: state.regimePerformanceState, sectorPerformanceState: state.sectorPerformanceState,
        confirmationPerformanceState: state.confirmationPerformanceState });
    } catch (error) { res.status(500).json({ ok: false, error: error.message }); }
  });
}
