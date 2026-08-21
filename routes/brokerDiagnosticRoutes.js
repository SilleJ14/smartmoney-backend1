const ACTIVE_STATUSES = new Set(["new", "accepted", "pending_new", "partially_filled", "pending_replace", "pending_cancel"]);
const CLOSED_STATUSES = new Set(["filled", "canceled", "expired", "rejected", "replaced"]);

export function classifyBotOrders(orders, isBotOrder) {
  const aiOrders = (orders || []).filter(isBotOrder);
  return {
    aiOrders,
    activeOrders: aiOrders.filter((order) => ACTIVE_STATUSES.has(String(order.status || "").toLowerCase())),
    closedOrders: aiOrders.filter((order) => CLOSED_STATUSES.has(String(order.status || "").toLowerCase())),
  };
}

export function registerBrokerDiagnosticRoutes(app, dependencies) {
  const { requireAdmin, getState, getPositions, getOrders, getBotOwnedSymbols, normalizeSymbol, getBotExposure, isBotOrder } = dependencies;
  app.get("/all-positions-test", requireAdmin, async (_req, res) => {
    try {
      const positions = await getPositions(), state = getState();
      res.json({ ok: true, count: positions.length, positions, aiManagedSymbols: state.aiManagedSymbols });
    } catch (error) { res.status(500).json({ ok: false, error: error.message }); }
  });
  app.get("/alpaca/raw-positions", requireAdmin, async (_req, res) => {
    try {
      const positions = await getPositions(), owned = await getBotOwnedSymbols(), state = getState();
      const aiPositions = positions.filter((position) => owned.has(normalizeSymbol(position.symbol)));
      res.json({ positions: aiPositions, allAlpacaPositions: positions, highWaterMarks: state.highWaterMarks,
        aiEntryScores: state.aiEntryScores, runnerPositions: state.runnerPositions, currentBotExposure: getBotExposure(aiPositions) });
    } catch (error) { res.status(500).json({ error: error.message }); }
  });
  app.get("/alpaca/raw-orders", requireAdmin, async (_req, res) => {
    try {
      const orders = await getOrders(), state = getState();
      const { aiOrders, activeOrders, closedOrders } = classifyBotOrders(orders, isBotOrder);
      res.json({ alpacaOrders: orders, aiAlpacaOrders: aiOrders, activeOrders, closedOrders,
        backendOrders: state.recentOrders, failedOrders: state.failedOrders, pendingExits: state.pendingExits,
        runnerPositions: state.runnerPositions, effectiveMode: state.effectiveMode,
        stockTradingStoppedForDay: state.stockTradingStoppedForDay, cryptoTradingStoppedForDay: state.cryptoTradingStoppedForDay });
    } catch (error) { res.status(500).json({ error: error.message }); }
  });
}
