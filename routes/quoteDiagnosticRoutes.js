export function registerQuoteDiagnosticRoutes(app, dependencies) {
  const { requireAdmin, normalizeSymbol, getStockQuote, getAsset, polygonQuote, getPolygonContext } = dependencies;
  app.get("/stock-quote/:symbol", requireAdmin, async (req, res) => {
    try {
      const symbol = normalizeSymbol(req.params.symbol), quote = await getStockQuote(symbol);
      const asset = await getAsset(symbol).catch(() => null);
      if (!quote?.current) return res.status(404).json({ ok: false, error: "No quote found", symbol });
      res.json({ ok: true, stock: {
        symbol, current: quote.current, price: quote.current, previousClose: quote.previousClose,
        changePercent: quote.previousClose ? ((quote.current - quote.previousClose) / quote.previousClose) * 100 : 0,
        percentChange: quote.percentChange, open: quote.open, dayOpen: quote.open,
        liveQuoteUpdatedAt: quote.quoteFetchedAt, liveQuoteSource: quote.liveQuoteSource,
        priceIsLive: quote.priceIsLive === true, chartBars: quote.chartBars || [],
        historicalBars: quote.historicalBars || [], sparkline: quote.sparkline || [],
        source: quote.source || "polygon_first_manual_search", autoTradeAllowed: false,
        manuallyBuyable: true, fractionable: asset?.fractionable === true,
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
