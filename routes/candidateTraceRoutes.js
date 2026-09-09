export function registerCandidateTraceRoutes(app, { requireAdmin, store }) {
  app.get('/discovery/trace', requireAdmin, async (req, res) => {
    const symbol = typeof req.query.symbol === 'string' ? req.query.symbol.toUpperCase().trim() : '';
    if (!/^[A-Z0-9][A-Z0-9._-]{0,15}(?:\/[A-Z0-9]{1,10})?$/.test(symbol)) return res.status(400).json({ ok: false, error: 'Provide one valid symbol' });
    try { return res.json({ ok: true, symbol, ...(await store.read(symbol, req.query.limit)) }); }
    catch (error) { return res.status(error.message === 'TRACE_QUERY_BUSY' ? 429 : 503).json({ ok: false, error: 'Candidate history temporarily unavailable' }); }
  });
}
