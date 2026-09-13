// Explanation only. Never changes scores, sizing or approval.
const num = x => typeof x === 'number' && Number.isFinite(x) ? x : null;
const round = x => Math.round(x * 100) / 100;
export function candidateDiagnostics(signal, evidence = {}, gate = {}) {
  evidence ||= {}; gate ||= {};
  const list = x => Array.isArray(x) ? x : [];
  const reasons = [...new Set([...list(evidence.missingCriticalEvidence), ...list(gate.reasons)])].filter(x => typeof x === 'string');
  const freshness = reasons.filter(x => /STALE|freshLive|freshDiscovery|EXPIRED/.test(x));
  const missing = reasons.filter(x => /UNAVAILABLE|MISSING|Coverage|barHistory|^liquidity$|^entryQuality$|^discovery$|^liveSpread$/.test(x));
  const components = list(evidence.components).filter(c => c && typeof c === 'object').slice(0, 12).map(c => {
    const weight = Math.max(0, Math.min(1, num(c.weight) ?? 0));
    const available = c.available === true && num(c.value) !== null;
    const contribution = available ? num(c.contribution) ?? round(c.value * weight) : 0;
    return { name: String(c.semanticName || c.name).slice(0, 64), available, weight,
      measuredScore: available ? c.value : null, contribution,
      missingEvidencePoints: available ? 0 : round(weight * 100),
      measuredShortfallPoints: available ? round(Math.max(0, weight * 100 - contribution)) : 0 };
  });
  const crypto = signal.assetClass === 'crypto' || String(signal.symbol).includes('/');
  const score = crypto ? signal.cryptoDecisionScore : signal.stockDecisionScore;
  const available = crypto ? signal.cryptoDecisionScoreAvailable : signal.stockDecisionScoreAvailable;
  const threshold = crypto ? 65 : 78;
  const currentFinal = available === true ? num(score) : null;
  const status = gate.approved === true ? 'APPROVED'
    : freshness.length ? 'WAITING_FOR_FRESH_DATA'
    : missing.length || currentFinal === null ? 'INSUFFICIENT_EVIDENCE'
    : currentFinal < threshold ? 'BELOW_SCORE_THRESHOLD' : 'WAITING_FOR_ENTRY_OR_RISK_APPROVAL';
  return { status, threshold, currentFinal,
    lastMeasuredFinal: num(signal.lastMeasuredAssessment?.final),
    lastMeasuredAt: signal.lastMeasuredAssessment?.at || null,
    freshnessReasons: freshness, missingEvidenceReasons: missing,
    blockingReasons: reasons, components,
    missingEvidencePoints: round(components.reduce((n,c)=>n+c.missingEvidencePoints,0)),
    measuredShortfallPoints: round(components.reduce((n,c)=>n+c.measuredShortfallPoints,0)),
    interpretation: 'Missing-evidence points are not measured weakness. Component contributions explain the component model, not a replacement approved F.',
  };
}

export function summarizeCandidateDiagnostics(rows) {
  const statuses = {}, blockers = {};
  for (const row of rows) {
    const d = row.currentDecision?.diagnostics;
    if (!d) continue;
    statuses[d.status] = (statuses[d.status] || 0) + 1;
    for (const reason of d.blockingReasons) blockers[reason] = (blockers[reason] || 0) + 1;
  }
  return { statuses, blockers, candidates: rows.map(row => ({ symbol: row.symbol, ...row.currentDecision?.diagnostics })) };
}
