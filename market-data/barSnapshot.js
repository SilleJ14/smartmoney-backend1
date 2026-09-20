import { createHash } from 'node:crypto';
// Identity of the exact ordered input used by a dependent calculation.
// Missing timestamps remain explicitly missing; receipt time is never inserted.
export function barSnapshot(bars) {
  if (!Array.isArray(bars) || !bars.length) return { id: null, available: false, reason: 'BAR_HISTORY_UNAVAILABLE' };
  let previous = null;
  let missingTimestamp = false;
  const gaps=[];
  for (const bar of bars) {
    if (!bar || typeof bar !== 'object' || Array.isArray(bar)) return { id: null, available: false, reason: 'MALFORMED_BAR' };
    const close = Number(bar.c ?? bar.close);
    if (!Number.isFinite(close) || close <= 0) return { id: null, available: false, reason: 'INVALID_BAR_CLOSE' };
    const raw = bar.t ?? bar.time ?? bar.timestamp;
    if (raw != null && raw !== '') {
      const numeric = Number(raw);
      const time = Number.isFinite(numeric) ? numeric < 1e10 ? numeric * 1000 : numeric : Date.parse(raw);
      if (!Number.isFinite(time) || time <= 0 || previous != null && time <= previous) return { id: null, available: false, reason: 'BAR_SEQUENCE_INVALID' };
      if(previous!=null)gaps.push(time-previous);
      previous = time;
    } else missingTimestamp = true;
  }
  return { id: createHash('sha256').update(JSON.stringify(bars)).digest('hex'), available: true,
    count: bars.length, intervalMs: !missingTimestamp && gaps.length ? gaps.sort((a,b)=>a-b)[Math.floor(gaps.length/2)] : null,
    lastProviderAt: missingTimestamp || previous == null ? null : new Date(previous).toISOString() };
}
