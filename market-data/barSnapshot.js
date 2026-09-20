import { createHash } from 'node:crypto';
const identities = new WeakMap();
const immutable = value => !value || typeof value !== 'object' ||
  Object.isFrozen(value) && Object.values(value).every(immutable);
export function immutableBarHistory(bars) {
  if (!Array.isArray(bars)) return bars;
  const copy = structuredClone(bars);
  const freeze = value => {
    if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
    return value;
  };
  return freeze(copy);
}
// Identity of the exact ordered input used by a dependent calculation.
// Missing timestamps remain explicitly missing; receipt time is never inserted.
export function barSnapshot(bars) {
  if (!Array.isArray(bars) || !bars.length) return { id: null, available: false, reason: 'BAR_HISTORY_UNAVAILABLE' };
  if (identities.has(bars)) return identities.get(bars);
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
      if (!Number.isFinite(time) || time <= 0 || time > 8640000000000000 || previous != null && time <= previous) return { id: null, available: false, reason: 'BAR_SEQUENCE_INVALID' };
      if(previous!=null)gaps.push(time-previous);
      previous = time;
    } else missingTimestamp = true;
  }
  const result = Object.freeze({ id: createHash('sha256').update(JSON.stringify(bars)).digest('hex'), available: true,
    count: bars.length, intervalMs: !missingTimestamp && gaps.length ? gaps.sort((a,b)=>a-b)[Math.floor(gaps.length/2)] : null,
    lastProviderAt: missingTimestamp || previous == null ? null : new Date(previous).toISOString() });
  // Only immutable data can be memoized by identity. Mutable callers continue
  // to be rehashed; editing a bar must never leave an old dependency identity.
  if (immutable(bars)) identities.set(bars, result);
  return result;
}
