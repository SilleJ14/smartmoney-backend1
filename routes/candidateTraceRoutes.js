import { buildCurrentDecisionView } from '../scoring/currentDecisionView.js';
import { summarizeCandidateDiagnostics } from '../scoring/candidateDiagnostics.js';
export function registerCandidateTraceRoutes(app, { requireAdmin, store, getCandidates = () => [] }) {
  app.get('/discovery/scans', requireAdmin, async (req, res) => {
    try { return res.json({ ok: true, ...(await store.read(null, req.query.limit)) }); }
    catch { return res.status(503).json({ ok: false, error: 'Scan history temporarily unavailable' }); }
  });
  app.get('/discovery/diagnostics', requireAdmin, (req, res) => {
    try {
    const rows = [...new Map(getCandidates().map(s => [s.symbol, s])).values()].slice(0, 250)
      .filter(s => req.query.asset !== 'crypto' || String(s.symbol).includes('/'))
      .filter(s => req.query.asset !== 'stock' || !String(s.symbol).includes('/'))
      .map(s => ({ ...s, currentDecision: buildCurrentDecisionView(s) }));
    return res.json({ ok: true, evaluatedAt: new Date().toISOString(), ...summarizeCandidateDiagnostics(rows),
      scope: 'Current retained candidates, not the entire market. No thresholds are automatically adjusted.' });
    } catch { return res.status(503).json({ ok: false, error: 'Candidate diagnostics temporarily unavailable' }); }
  });
  app.get('/discovery/trace', requireAdmin, async (req, res) => {
    const symbol = typeof req.query.symbol === 'string' ? req.query.symbol.toUpperCase().trim() : '';
    if (!/^[A-Z0-9][A-Z0-9._-]{0,15}(?:\/[A-Z0-9]{1,10})?$/.test(symbol)) return res.status(400).json({ ok: false, error: 'Provide one valid symbol' });
    try { return res.json({ ok: true, symbol, ...(await store.read(symbol, req.query.limit)) }); }
    catch (error) { return res.status(error.message === 'TRACE_QUERY_BUSY' ? 429 : 503).json({ ok: false, error: 'Candidate history temporarily unavailable' }); }
  });
}
