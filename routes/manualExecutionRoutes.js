export function clearClosedPositionState(state, symbol, closedAt) {
  state.symbolCooldowns[symbol] = closedAt;
  delete state.highWaterMarks[symbol]; delete state.aiEntryScores[symbol]; delete state.runnerPositions[symbol];
}

export function registerManualExecutionRoutes(app, dependencies) {
  const { requireAdmin, normalizeSymbol, getAsset, getStockQuote, manualStockBuy,
    markManagedSymbol, getState, closePosition, recordOrder, recordFailedOrder,
    now = () => new Date(), logger = console } = dependencies;
  app.post("/manual-buy-stock", requireAdmin, async (req, res) => {
    try {
      const { symbol, dollars, shares, buyMode, holdCategory } = req.body;
      const cleanSymbol = normalizeSymbol(symbol), amount = Number(dollars), shareAmount = Number(shares || 0);
      const mode = String(buyMode || "dollars");
      if (!cleanSymbol) throw new Error("Missing symbol");
      const asset = await getAsset(cleanSymbol), fractionable = asset?.fractionable === true;
      if (mode !== "shares" && (!amount || amount < 1)) throw new Error("Invalid dollar amount");
      let referencePrice;
      if (mode !== "shares" && !fractionable) referencePrice = Number((await getStockQuote(cleanSymbol)).current || 0);
      const order = await manualStockBuy({ symbol: cleanSymbol, dollars: amount, shares: shareAmount,
        buyMode: mode, fractionable, referencePrice, holdCategory });
      logger.log("MANUAL BUY ORDER:", order);
      if (!order?.id) return res.json({ ok: false, error: "Order not created" });
      markManagedSymbol(cleanSymbol);
      return res.json({ ok: true, message: `${cleanSymbol} manual buy placed. Bot can manage exit.`,
        symbol: cleanSymbol, dollars: amount, aiManagedSymbols: getState().aiManagedSymbols, order });
    } catch (error) { res.status(500).json({ ok: false, error: error.message }); }
  });
  app.post("/close-position", requireAdmin, async (req, res) => {
    const { symbol } = req.body;
    if (!symbol) return res.status(400).json({ error: "symbol is required" });
    try {
      const normalized = normalizeSymbol(symbol), result = await closePosition(normalized);
      recordOrder("MANUAL_CLOSE", normalized, { result });
      clearClosedPositionState(getState(), normalized, now().toISOString());
      res.json({ message: `Close position submitted for ${normalized}`, result });
    } catch (error) {
      recordFailedOrder("MANUAL_CLOSE_FAILED", symbol, error.message);
      res.status(500).json({ error: error.message });
    }
  });
}
