const finite = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
const mean = values => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
function correlation(pairs) {
  const x = mean(pairs.map(p => p.x)), y = mean(pairs.map(p => p.y));
  const xx = pairs.reduce((s, p) => s + (p.x - x) ** 2, 0);
  const yy = pairs.reduce((s, p) => s + (p.y - y) ** 2, 0);
  return xx > 0 && yy > 0 ? pairs.reduce((s, p) => s + (p.x - x) * (p.y - y), 0) / Math.sqrt(xx * yy) : 0;
}

// Fixed chronological split, with an embargo until every training outcome was
// observable. Never optimize on the held-out sample or on intraperiod peaks.
export function validateQuietLearning(observations, horizonDays, minSamples = 30, frozenCutoff = null, maxAdjustment = 0.1) {
  const rows = observations.filter(o => finite(o.observedAt) && Number(o.observedAt) > 0 &&
    o.executionCostModelVersion === 1 && finite(o.estimatedRoundTripCostPercent) && Number(o.estimatedRoundTripCostPercent) >= 0 &&
    finite(o.measurements?.[horizonDays]?.closeReturnPercent) && Object.values(o.componentWeights || {}).some(w => finite(w) && Number(w) > 0))
    .sort((a, b) => Number(a.observedAt) - Number(b.observedAt) || String(a.id).localeCompare(String(b.id)));
  const split = Math.floor(rows.length * 0.6);
  const trainingCutoffAt = finite(frozenCutoff) && Number(frozenCutoff) > 0 ? Number(frozenCutoff)
    : rows.length >= minSamples * 2 ? Number(rows[Math.max(0, split - 1)].observedAt) : null;
  const train = trainingCutoffAt === null ? rows.slice(0, split) : rows.filter(o => Number(o.observedAt) <= trainingCutoffAt);
  const observableAt = o => Number(o.measurements[horizonDays].evidenceTimestamp) ||
    Date.parse(`${o.measurements[horizonDays].measuredDay || ''}T23:59:59.999Z`);
  const trainEnd = train.length && train.every(o => Number.isFinite(observableAt(o)))
    ? Math.max(...train.map(observableAt)) : Infinity;
  const holdout = rows.filter(o => Number(o.observedAt) > trainEnd && (trainingCutoffAt === null || Number(o.observedAt) > trainingCutoffAt));
  const names = [...new Set(train.flatMap(o => Object.keys(o.componentScores || {})))].slice(0, 64);
  const outcome = o => Number(o.measurements[horizonDays].closeReturnPercent) - Number(o.estimatedRoundTripCostPercent);
  const multipliers = {}, correlations = {};
  for (const name of names) {
    const pairs = train.filter(o => finite(o.componentScores?.[name])).map(o => ({ x: Number(o.componentScores[name]), y: outcome(o) }));
    const r = pairs.length >= minSamples ? correlation(pairs) : 0;
    correlations[name] = { sampleCount: pairs.length, correlation: Number(r.toFixed(4)) };
    multipliers[name] = Number(Math.max(1 - maxAdjustment, Math.min(1 + maxAdjustment, 1 + r * maxAdjustment)).toFixed(4));
  }
  const score = (o, weighted) => {
    const valid = names.filter(name => finite(o.componentScores?.[name]) && finite(o.componentWeights?.[name]) && Number(o.componentWeights[name]) > 0);
    const weight = name => Number(o.componentWeights[name]) * (weighted ? multipliers[name] : 1);
    return valid.length ? valid.reduce((sum, name) => sum + Number(o.componentScores[name]) * weight(name), 0) /
      valid.reduce((sum, name) => sum + weight(name), 0) : null;
  };
  const groups = new Map();
  for (const row of holdout) {
    if (score(row, false) === null) continue;
    const key = row.observedDay || new Date(Number(row.observedAt)).toISOString().slice(0, 10);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const dailyReturns = weighted => [...groups.values()].filter(group => group.length >= 2).map(group => {
    const ranked = [...group].sort((a, b) => score(b, weighted) - score(a, weighted) || String(a.id).localeCompare(String(b.id)));
    return mean(ranked.slice(0, Math.max(1, Math.floor(ranked.length / 2))).map(outcome));
  });
  const baseline = dailyReturns(false), challenger = dailyReturns(true);
  const ready = train.length >= minSamples && holdout.length >= minSamples &&
    new Set(train.map(o => o.symbol)).size >= 10 && new Set(holdout.map(o => o.symbol)).size >= 10 && challenger.length >= 3;
  const baselineNet = baseline.length ? mean(baseline) : null;
  const challengerNet = challenger.length ? mean(challenger) : null;
  const active = ready && challengerNet > 0 && challengerNet > baselineNet + 0.1;
  return { active, modelVersion: 2, trainingCutoffAt, trainingCount: train.length, holdoutCount: holdout.length,
    embargoUntil: Number.isFinite(trainEnd) ? trainEnd : null, holdoutDayCount: challenger.length,
    baselineNetReturnPercent: baselineNet, challengerNetReturnPercent: challengerNet,
    returnBasis: 'HORIZON_CLOSE_MINUS_FROZEN_ESTIMATED_COSTS_NOT_REALIZED_PNL',
    componentCorrelations: correlations,
    proposedComponentMultipliers: multipliers,
    componentMultipliers: Object.fromEntries(names.map(name => [name, active ? multipliers[name] : 1])),
    reason: !ready ? 'WAITING_FOR_PURGED_OUT_OF_SAMPLE_EVIDENCE' : active
      ? 'NET_RETURN_HOLDOUT_VALIDATED' : 'CHALLENGER_DID_NOT_BEAT_BASELINE_AFTER_COSTS' };
}
