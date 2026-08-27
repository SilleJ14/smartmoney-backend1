export function registerQuoteDiagnosticRoutes(app, dependencies) {
  const {
    requireAdmin, normalizeSymbol, getStockQuote, getVerifiedStockQuote,
    validateStockBuyability, getAsset, polygonQuote, getPolygonContext,
  } = dependencies;
  app.get("/stock-quote/:symbol", requireAdmin, async (req, res) => {
    try {
      const symbol = normalizeSymbol(req.params.symbol);
      const verified = typeof getVerifiedStockQuote === "function"
        ? await getVerifiedStockQuote(symbol)
        : null;
      const quote = await getStockQuote(symbol);
      const asset = await getAsset(symbol).catch(() => null);
      const liveQuote = verified?.quote || null;
      const buyability = typeof validateStockBuyability === "function"
        ? await validateStockBuyability(symbol)
        : { approved: false, blockReasons: ["Live buyability was not verified"] };
      const current = Number(liveQuote?.current || liveQuote?.price || quote?.current || 0);
      if (!current) return res.status(404).json({ ok: false, error: "No quote found", symbol });
      res.json({ ok: true, stock: {
        symbol, current, price: current, previousClose: quote.previousClose,
        changePercent: quote.previousClose ? ((current - quote.previousClose) / quote.previousClose) * 100 : 0,
        percentChange: quote.percentChange, open: quote.open, dayOpen: quote.open,
        bid: Number(liveQuote?.bid || 0) || null,
        ask: Number(liveQuote?.ask || 0) || null,
        spreadPercent: buyability.spreadPercent ?? liveQuote?.spreadPercent ?? null,
        spreadAvailable: buyability.spreadAvailable === true,
        quoteAgeSeconds: buyability.quoteAgeSeconds ?? null,
        liveQuoteUpdatedAt: liveQuote?.liveQuoteUpdatedAt || liveQuote?.updatedAt || null,
        liveQuoteSource: liveQuote?.liveQuoteSource || liveQuote?.source || quote.liveQuoteSource,
        priceIsLive: liveQuote?.priceIsLive === true && buyability.quoteIsLive === true,
        priceStale:
          buyability.quoteAgeSeconds === null ||
          buyability.quoteAgeSeconds < -5 ||
          buyability.quoteAgeSeconds > 5,
        chartBars: quote.chartBars || [],
        historicalBars: quote.historicalBars || quote.chartBars || [], sparkline: quote.sparkline || [],
        source: quote.source || "polygon_first_manual_search", autoTradeAllowed: false,
        quoteExecutable: (buyability.quoteApproved ?? buyability.approved) === true,
        manuallyBuyable: buyability.approved === true,
        buyBlockReasons: buyability.blockReasons || [],
        buyabilityCheckedAt: buyability.checkedAt || new Date().toISOString(),
        fractionable: asset?.fractionable === true,
        assetClass: asset?.asset_class || "us_equity",
      } });
    } catch (error) { res.status(500).json({ ok: false, error: error.message }); }
  });
  app.get("/polygon-test/:symbol", requireAdmin, async (req, res) => {
    try {
      const symbol = normalizeSymbol(req.params.symbol), quote = await polygonQuote(symbol), context = getPolygonContext();
      res.json({ ok: !!quote, symbol, polygonEnabled: context.enabled, polygonPrimary: context.primary,
        polygonKeyFound: context.keyFound, quote, polygonFailures: context.failures });
    } catch (error) { res.status(500).json({ ok: false, error: error.message }); }
  });
}
