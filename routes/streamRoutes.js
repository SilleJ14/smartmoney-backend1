import { attachBoundedStream, closeBoundedStream, writeBoundedStream,
  DEFAULT_STREAM_CLIENT_LIMIT } from "../live/boundedStream.js";

const headers = (origin) => ({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache",
  Connection: "keep-alive", "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Credentials": "true" });

export function registerStreamRoutes(app, dependencies) {
  const { requireAdmin, normalizeSymbol, getCorsOrigin, backendClients, liveSignalClients,
    replayEvents, getState, getMode, buildLiveSignalPayload,
    maxClients = DEFAULT_STREAM_CLIENT_LIMIT,
    setIntervalFn = setInterval, clearIntervalFn = clearInterval, now = () => new Date() } = dependencies;
  const clientLimit = Math.max(1, Math.min(64, Math.floor(Number(maxClients) || DEFAULT_STREAM_CLIENT_LIMIT)));
  const admitClient = (res) => {
    if (backendClients.size + liveSignalClients.size < clientLimit) return true;
    res.setHeader?.("Retry-After", "15");
    res.status(503).json({ ok: false, error: "Live stream capacity reached. Use polling and reconnect shortly." });
    return false;
  };
  app.get("/stream", requireAdmin, (req, res) => {
    if (!admitClient(res)) return;
    res.writeHead(200, headers(getCorsOrigin(req)));
    const allowedSymbols = String(req.query.symbols || "").slice(0, 4096).split(",").slice(0, 200).map(normalizeSymbol).filter(Boolean);
    let heartbeat;
    attachBoundedStream(res, { onClose: () => { clearIntervalFn(heartbeat); backendClients.delete(res); } });
    req.on("close", () => closeBoundedStream(res));
    res.allowedSymbols = allowedSymbols;
    backendClients.add(res);
    try { replayEvents(res, String(req.query.since || "")); }
    catch { closeBoundedStream(res); return; }
    if (!backendClients.has(res)) return;
    try {
      const state = getState();
      if (!writeBoundedStream(res, `event: CONNECTED\ndata: ${JSON.stringify({ type: "CONNECTED", generatedAt: now().toISOString(),
        payload: { message: "SmartMoney enhanced stream connected", allowedSymbols, marketOpen: state.marketOpen,
          mode: getMode(), effectiveMode: state.effectiveMode, lastScanAt: state.lastScanAt } })}\n\n`)) return;
    } catch { closeBoundedStream(res); return; }
    heartbeat = setIntervalFn(() => {
      try {
        const current = getState();
        writeBoundedStream(res, `event: HEALTH_EVENT\ndata: ${JSON.stringify({ type: "HEALTH_EVENT", generatedAt: now().toISOString(), payload: {
          running: current.running, marketOpen: current.marketOpen,
          lastScanAt: current.lastScanAt, lastSuccessfulCycleAt: current.lastSuccessfulCycleAt,
          lastError: current.lastError, liveQuoteCount: Object.keys(current.liveQuoteCache || {}).length,
          streamClientCount: backendClients.size } })}\n\n`);
      } catch { closeBoundedStream(res); }
    }, 15000);
    heartbeat?.unref?.();
  });
  app.get("/live-signals/stream", requireAdmin, (req, res) => {
    if (!admitClient(res)) return;
    res.writeHead(200, headers(getCorsOrigin(req)));
    attachBoundedStream(res, { onClose: () => liveSignalClients.delete(res) });
    liveSignalClients.add(res);
    req.on("close", () => closeBoundedStream(res));
    try { writeBoundedStream(res, `data: ${JSON.stringify(buildLiveSignalPayload())}\n\n`); }
    catch { closeBoundedStream(res); }
  });
}
