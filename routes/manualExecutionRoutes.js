export function clearClosedPositionState(state, symbol, closedAt) {
  state.symbolCooldowns[symbol] = closedAt;
  delete state.highWaterMarks[symbol]; delete state.aiEntryScores[symbol]; delete state.runnerPositions[symbol];
}

export function registerManualExecutionRoutes(app, dependencies) {
  const { requireAdmin, normalizeSymbol, getAsset, getStockQuote, manualStockBuy,
    manualCryptoBuy,
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
  app.post("/manual-buy-crypto", requireAdmin, async (req, res) => {
    const cleanSymbol = normalizeSymbol(req.body?.symbol);
    const dollars = Number(req.body?.dollars);
    try {
      if (!cleanSymbol) return res.status(400).json({ ok: false, error: "Missing crypto symbol" });
      if (!Number.isFinite(dollars) || dollars < 1) return res.status(400).json({ ok: false, error: "Invalid dollar amount" });
      const state = getState();
      const candidates = Array.isArray(state.lastCryptoSignals) ? state.lastCryptoSignals : [];
      const candidate = candidates.find((item) => normalizeSymbol(item?.symbol) === cleanSymbol);
      if (!candidate) return res.status(409).json({ ok: false, error: "Crypto candidate is no longer in the verified live set" });
      if (candidate.qualifiedToBuy !== true || candidate.priceIsLive !== true || candidate.spreadAvailable !== true) {
        return res.status(409).json({ ok: false, error: "Crypto candidate no longer passes entry and live-spread gates" });
      }
      const sizingLimit = Number(candidate.recommendedTradeAmount || candidate.suggestedTradeAmount || 0);
      if (!Number.isFinite(sizingLimit) || sizingLimit < 1 || dollars > sizingLimit + 0.01) {
        return res.status(409).json({ ok: false, error: "Requested crypto amount exceeds the current verified sizing limit" });
      }
      const order = await manualCryptoBuy({ symbol: cleanSymbol, dollars });
      if (!order?.id) return res.status(502).json({ ok: false, error: "Crypto order was not created" });
      markManagedSymbol(cleanSymbol);
      recordOrder("MANUAL_CRYPTO_BUY", cleanSymbol, { orderId: order.id, dollars, source: "VERIFIED_CRYPTO_ROUTE" });
      return res.json({ ok: true, symbol: cleanSymbol, dollars, order });
    } catch (error) {
      recordFailedOrder("MANUAL_CRYPTO_BUY_FAILED", cleanSymbol, error.message);
      return res.status(409).json({ ok: false, error: error.message });
    }
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
