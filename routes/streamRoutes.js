const headers = (origin) => ({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache",
  Connection: "keep-alive", "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Credentials": "true" });

export function registerStreamRoutes(app, dependencies) {
  const { requireAdmin, normalizeSymbol, getCorsOrigin, backendClients, liveSignalClients,
    replayEvents, pushEvent, getState, getMode, buildLiveSignalPayload,
    setIntervalFn = setInterval, clearIntervalFn = clearInterval, now = () => new Date() } = dependencies;
  app.get("/stream", requireAdmin, (req, res) => {
    res.writeHead(200, headers(getCorsOrigin(req)));
    const allowedSymbols = String(req.query.symbols || "").split(",").map(normalizeSymbol).filter(Boolean);
    res.allowedSymbols = allowedSymbols; backendClients.add(res); replayEvents(res, String(req.query.since || ""));
    const state = getState();
    res.write(`event: CONNECTED\ndata: ${JSON.stringify({ type: "CONNECTED", generatedAt: now().toISOString(),
      payload: { message: "SmartMoney enhanced stream connected", allowedSymbols, marketOpen: state.marketOpen,
        mode: getMode(), effectiveMode: state.effectiveMode, lastScanAt: state.lastScanAt } })}\n\n`);
    const heartbeat = setIntervalFn(() => {
      const current = getState();
      pushEvent("HEALTH_EVENT", { running: current.running, marketOpen: current.marketOpen,
        lastScanAt: current.lastScanAt, lastSuccessfulCycleAt: current.lastSuccessfulCycleAt,
        lastError: current.lastError, liveQuoteCount: Object.keys(current.liveQuoteCache || {}).length,
        streamClientCount: backendClients.size });
    }, 15000);
    req.on("close", () => { clearIntervalFn(heartbeat); backendClients.delete(res); });
  });
  app.get("/live-signals/stream", requireAdmin, (req, res) => {
    res.writeHead(200, headers(getCorsOrigin(req)));
    res.write(`data: ${JSON.stringify(buildLiveSignalPayload())}\n\n`);
    liveSignalClients.add(res);
    req.on("close", () => liveSignalClients.delete(res));
  });
}
