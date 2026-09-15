// Offline, time-ordered comparison. Never imports an order service or changes
// production policy. Outcomes use observed quotes, not unobserved intrabar highs.
export function compareEntryPolicies(candidates, specification) {
  const s = specification || {};
  const time = value => typeof value === 'number' ? value : Date.parse(value);
  const start = time(s.evaluationStart), end = time(s.evaluationEnd), trainingEnd = time(s.trainingEnd);
  for (const key of ['targetPercent', 'stopPercent', 'horizonMs', 'minimumSample', 'maximumEarlyMovePercent']) {
    if (!(Number.isFinite(s[key]) && s[key] > 0)) throw new Error(`REPLAY_SPEC_REQUIRED: ${key}`);
  }
  for (const key of ['feePercentPerSide', 'slippagePercentPerSide']) {
    if (!(Number.isFinite(s[key]) && s[key] >= 0)) throw new Error(`REPLAY_COST_REQUIRED: ${key}`);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(trainingEnd) ||
      start <= trainingEnd + s.horizonMs || end <= start) throw new Error('REPLAY_HOLDOUT_OR_EMBARGO_INVALID');
  if (!Array.isArray(candidates)) throw new Error('REPLAY_CANDIDATES_REQUIRED');
  const outcomes = [];
  for (const candidate of candidates) {
    if (!['stock', 'crypto'].includes(candidate?.assetClass) || !candidate.symbol || !Array.isArray(candidate.observations)) {
      throw new Error('REPLAY_CANDIDATE_INVALID');
    }
    const rows = candidate.observations;
    for (let i = 0; i < rows.length; i++) {
      if (!rows[i] || !Number.isFinite(time(rows[i].at)) || (i && time(rows[i].at) <= time(rows[i-1].at))) {
        throw new Error('REPLAY_OBSERVATIONS_NOT_STRICTLY_CHRONOLOGICAL');
      }
    }
    for (const policy of ['early_setup', 'confirmed_trigger']) {
      let entry = null, first = null, result = null;
      for (const row of rows) {
        const at = time(row.at);
        if (at < start || at > end) continue;
        if (!(Number.isFinite(row.bid) && row.bid > 0 && Number.isFinite(row.ask) && row.ask >= row.bid)) continue;
        first ??= row;
        if (!entry) {
          const triggered = policy === 'early_setup' ? row.setupDetected === true : row.triggerConfirmed === true;
          if (!triggered) continue;
          if (policy === 'early_setup' && (row.ask / first.ask - 1) * 100 > s.maximumEarlyMovePercent) continue;
          entry = { at, price: row.ask * (1 + s.slippagePercentPerSide / 100) };
          continue; // No same-observation exit or lookahead entry.
        }
        const move = (row.bid / entry.price - 1) * 100;
        const reason = move <= -s.stopPercent ? 'STOP' : move >= s.targetPercent ? 'TARGET'
          : at - entry.at >= s.horizonMs ? 'HORIZON' : null;
        if (!reason) continue;
        const exit = row.bid * (1 - s.slippagePercentPerSide / 100);
        result = { status: 'COMPLETE', reason, entryAt: entry.at, exitAt: at,
          netReturnPercent: (exit / entry.price - 1) * 100 - 2 * s.feePercentPerSide };
        break;
      }
      outcomes.push({ symbol: candidate.symbol, assetClass: candidate.assetClass, policy,
        ...(result || { status: entry ? 'INCOMPLETE_HORIZON' : 'NO_ENTRY', netReturnPercent: null }) });
    }
  }
  const summaries = {};
  for (const asset of ['stock', 'crypto']) for (const policy of ['early_setup', 'confirmed_trigger']) {
    const rows = outcomes.filter(r => r.assetClass === asset && r.policy === policy);
    const complete = rows.filter(r => r.status === 'COMPLETE');
    summaries[`${asset}:${policy}`] = { candidates: rows.length, completed: complete.length,
      noEntry: rows.filter(r => r.status === 'NO_ENTRY').length,
      incomplete: rows.filter(r => r.status === 'INCOMPLETE_HORIZON').length,
      sampleSufficient: complete.length >= s.minimumSample,
      meanNetReturnPercent: complete.length ? complete.reduce((n,r) => n + r.netReturnPercent, 0) / complete.length : null };
  }
  return { specification: { ...s }, summaries, outcomes,
    limitations: 'Historical quote-sampled experiment, not executable approval or evidence of live profitability. Gaps, fills and intrabar paths are not simulated. Correlated/overlapping candidates require separate analysis.' };
}
