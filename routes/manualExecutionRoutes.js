export function clearClosedPositionState(state, symbol, closedAt) {
  state.symbolCooldowns[symbol] = closedAt;
  delete state.highWaterMarks[symbol]; delete state.aiEntryScores[symbol]; delete state.runnerPositions[symbol];
}

export function registerManualExecutionRoutes(app, dependencies) {
  const { requireAdmin, normalizeSymbol, getAsset, getStockQuote, manualStockBuy,
    manualCryptoBuy,
    evaluateCryptoCandidate, evaluateStockCandidate,
    getVerifiedStockQuote, getVerifiedCryptoQuote,
    markManagedSymbol, getState, closePosition, recordOrder, recordFailedOrder,
    getMarketOpen = async () => false,
    isCryptoSymbol = (symbol) => String(symbol || "").includes("/") || String(symbol || "").endsWith("USD"),
    now = () => new Date(), logger = console } = dependencies;
  const hydrateWithVerifiedQuote = (candidate, resolution) => {
    const quote = resolution?.quote || {};
    const updatedAt = quote.updatedAt || quote.liveQuoteUpdatedAt || quote.quoteFetchedAt || null;
    return {
      ...candidate,
      current: Number(quote.current || quote.price || candidate?.current || candidate?.price || 0),
      price: Number(quote.price || quote.current || candidate?.price || candidate?.current || 0),
      bid: Number(quote.bid || 0) > 0 ? Number(quote.bid) : null,
      ask: Number(quote.ask || 0) > 0 ? Number(quote.ask) : null,
      spreadPercent: quote.spreadAvailable === true ? Number(quote.spreadPercent) : null,
      spreadAvailable: quote.spreadAvailable === true,
      priceIsLive: resolution?.quoteReady === true && quote.priceIsLive === true,
      liveQuoteUpdatedAt: updatedAt,
      quoteFetchedAt: updatedAt,
      liveQuote: { ...quote, updatedAt },
      liveQuoteSource: quote.liveQuoteSource || quote.source || null,
    };
  };
  app.post("/manual-buy-stock", requireAdmin, async (req, res) => {
    try {
      const { symbol, dollars, shares, buyMode, holdCategory } = req.body;
      const cleanSymbol = normalizeSymbol(symbol), amount = Number(dollars), shareAmount = Number(shares || 0);
      const mode = String(buyMode || "dollars").toLowerCase();
      if (!cleanSymbol) throw new Error("Missing symbol");
      if (await getMarketOpen() !== true) {
        throw new Error(`${cleanSymbol} stock buy blocked because the regular market is closed`);
      }
      if (!["dollars", "shares"].includes(mode)) throw new Error("Invalid buy mode");
      const asset = await getAsset(cleanSymbol), fractionable = asset?.fractionable === true;
      if (asset?.status !== "active" || asset?.tradable !== true) {
        const error = new Error(`${cleanSymbol} is not an active tradable asset`);
        error.statusCode = 409;
        throw error;
      }
      if (mode !== "shares" && (!amount || amount < 1)) throw new Error("Invalid dollar amount");
      if (mode === "shares" && (!Number.isFinite(shareAmount) || shareAmount <= 0)) {
        throw new Error("Invalid share amount");
      }
      let referencePrice;
      if (mode !== "shares" && !fractionable) referencePrice = Number((await getStockQuote(cleanSymbol)).current || 0);
      const order = await manualStockBuy({ symbol: cleanSymbol, dollars: amount, shares: shareAmount,
        buyMode: mode, fractionable, referencePrice,
        holdCategory: holdCategory === "multi_day" ? "multi_day" : "intraday",
        marketOpen: true });
      logger.log("MANUAL BUY ORDER:", order);
      if (!order?.id) return res.json({ ok: false, error: "Order not created" });
      markManagedSymbol(cleanSymbol);
      recordOrder("MANUAL_STOCK_BUY", cleanSymbol, {
        orderId: order.id,
        buyMode: mode,
        dollars: mode === "dollars" ? amount : null,
        shares: mode === "shares" ? shareAmount : null,
        source: "VERIFIED_MANUAL_STOCK_ROUTE",
      });
      return res.json({ ok: true, message: `${cleanSymbol} manual buy placed. Bot can manage exit.`,
        symbol: cleanSymbol, dollars: amount, aiManagedSymbols: getState().aiManagedSymbols, order });
    } catch (error) {
      recordFailedOrder("MANUAL_STOCK_BUY_FAILED", req.body?.symbol, error.message);
      res.status(Number(error.statusCode || 409)).json({ ok: false, error: error.message });
    }
  });
  app.post("/buy-stock-signal", requireAdmin, async (req, res) => {
    const cleanSymbol = normalizeSymbol(req.body?.symbol);
    const dollars = Number(req.body?.dollars);
    const holdCategory = req.body?.holdCategory === "multi_day" ? "multi_day" : "intraday";
    try {
      if (!cleanSymbol) return res.status(400).json({ ok: false, error: "Missing stock symbol" });
      if (await getMarketOpen() !== true) {
        return res.status(409).json({ ok: false, error: `${cleanSymbol} stock buy blocked because the regular market is closed` });
      }
      if (!Number.isFinite(dollars) || dollars < 1) {
        return res.status(400).json({ ok: false, error: "Invalid dollar amount" });
      }
      const state = getState();
      const candidates = [
        ...(Array.isArray(state.lastStockSignals) ? state.lastStockSignals : []),
        ...(Array.isArray(state.topStockSignals) ? state.topStockSignals : []),
        ...(Array.isArray(state.lastSignals) ? state.lastSignals : []),
        ...(Array.isArray(state.topSignals) ? state.topSignals : []),
      ];
      const candidate = candidates.find((item) =>
        normalizeSymbol(item?.symbol) === cleanSymbol &&
        String(item?.assetClass || item?.asset_class || "stock").toLowerCase() !== "crypto"
      );
      if (!candidate) {
        return res.status(409).json({ ok: false, error: "Stock candidate is no longer in the current scored set" });
      }
      if (typeof getVerifiedStockQuote !== "function") {
        return res.status(503).json({ ok: false, error: "Verified stock quote service is unavailable" });
      }
      const quoteResolution = await getVerifiedStockQuote(cleanSymbol);
      if (quoteResolution?.quoteReady !== true) {
        return res.status(409).json({ ok: false, error: "A verified live stock quote is not available" });
      }
      const verifiedCandidate = hydrateWithVerifiedQuote(candidate, quoteResolution);
      const decision = typeof evaluateStockCandidate === "function"
        ? evaluateStockCandidate(verifiedCandidate)
        : { approved: false, reasons: ["Canonical stock decision verification is unavailable"] };
      if (decision?.approved !== true) {
        return res.status(409).json({
          ok: false,
          error: `Stock decision no longer passes: ${(decision?.reasons || ["incomplete evidence"]).join("; ")}`,
        });
      }
      const sizingLimit = Number(
        candidate.recommendedTradeAmount || candidate.recommendedDollarAmount || candidate.tradeAmount || 0
      );
      if (!Number.isFinite(sizingLimit) || sizingLimit < 1 || dollars > sizingLimit + 0.01) {
        return res.status(409).json({ ok: false, error: "Requested stock amount exceeds the current verified sizing limit" });
      }
      const asset = await getAsset(cleanSymbol);
      if (asset?.status !== "active" || asset?.tradable !== true) {
        return res.status(409).json({ ok: false, error: `${cleanSymbol} is not an active tradable asset` });
      }
      const fractionable = asset?.fractionable === true;
      const referencePrice = Number(verifiedCandidate.current || 0);
      const order = await manualStockBuy({
        symbol: cleanSymbol,
        dollars,
        buyMode: "dollars",
        fractionable,
        referencePrice,
        holdCategory,
        marketOpen: true,
      });
      if (!order?.id) return res.status(502).json({ ok: false, error: "Stock order was not created" });
      markManagedSymbol(cleanSymbol);
      recordOrder("AI_SIZED_STOCK_BUY", cleanSymbol, {
        orderId: order.id,
        dollars,
        holdCategory,
        finalScore: decision.finalScore,
        quoteAgeSeconds: decision.quoteAgeSeconds,
        source: "SERVER_REVERIFIED_AI_STOCK_ROUTE",
      });
      return res.json({ ok: true, symbol: cleanSymbol, dollars, holdCategory, decision, order });
    } catch (error) {
      recordFailedOrder("AI_SIZED_STOCK_BUY_FAILED", cleanSymbol, error.message);
      return res.status(Number(error.statusCode || 409)).json({ ok: false, error: error.message });
    }
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
      if (typeof getVerifiedCryptoQuote !== "function") {
        return res.status(503).json({ ok: false, error: "Verified crypto quote service is unavailable" });
      }
      const quoteResolution = await getVerifiedCryptoQuote(cleanSymbol);
      if (quoteResolution?.quoteReady !== true) {
        return res.status(409).json({ ok: false, error: "A verified live crypto quote is not available" });
      }
      const verifiedCandidate = hydrateWithVerifiedQuote(candidate, quoteResolution);
      const decision = typeof evaluateCryptoCandidate === "function"
        ? evaluateCryptoCandidate(verifiedCandidate)
        : { approved: false, reasons: ["Canonical crypto decision verification is unavailable"] };
      if (decision?.approved !== true) {
        return res.status(409).json({
          ok: false,
          error: `Crypto decision no longer passes: ${(decision?.reasons || ["incomplete evidence"]).join("; ")}`,
        });
      }
      if (candidate.qualifiedToBuy !== true || verifiedCandidate.priceIsLive !== true || verifiedCandidate.spreadAvailable !== true) {
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
      const normalized = normalizeSymbol(symbol);
      if (!isCryptoSymbol(normalized) && await getMarketOpen() !== true) {
        return res.status(409).json({ error: `${normalized} stock close blocked because the regular market is closed` });
      }
      const result = await closePosition(normalized);
      recordOrder("MANUAL_CLOSE", normalized, { result });
      clearClosedPositionState(getState(), normalized, now().toISOString());
      res.json({ message: `Close position submitted for ${normalized}`, result });
    } catch (error) {
      recordFailedOrder("MANUAL_CLOSE_FAILED", symbol, error.message);
      res.status(Number(error.statusCode || 500)).json({ error: error.message });
    }
  });
}
