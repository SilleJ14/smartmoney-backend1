import fs from 'node:fs';
import path from 'node:path';

const fields = ['dailyDateKey', 'dailyStartEquity', 'dailyPeakEquity', 'profitLockFloorEquity',
  'dailyLossLocked', 'profitLocked', 'stockTradingStoppedForDay', 'cryptoTradingStoppedForDay',
  'liveTradeLimitState', 'orderRiskReservations', 'safetyReconciliationRequired'];
const maxBytes = 2 * 1024 * 1024;
function validSafetyState(state) {
  if (!state || Array.isArray(state) || typeof state !== 'object') return false;
  const nonnegative = v => typeof v === 'number' && Number.isFinite(v) && v >= 0;
  for (const key of ['dailyStartEquity', 'dailyPeakEquity', 'profitLockFloorEquity']) {
    if (state[key] != null && !nonnegative(state[key])) return false;
  }
  for (const key of ['dailyLossLocked', 'profitLocked', 'stockTradingStoppedForDay', 'cryptoTradingStoppedForDay', 'safetyReconciliationRequired']) {
    if (state[key] != null && typeof state[key] !== 'boolean') return false;
  }
  const limits = state.liveTradeLimitState;
  if (limits != null && (typeof limits !== 'object' || Array.isArray(limits) ||
    !Number.isInteger(limits.intradayStockEntriesToday) || limits.intradayStockEntriesToday < 0)) return false;
  for (const intent of Object.values(limits?.positionIntents || {})) {
    if (!intent || !['intraday', 'multi_day', 'crypto'].includes(intent.holdCategory) ||
      !Number.isFinite(Date.parse(intent.enteredAt)) || (intent.pending != null && typeof intent.pending !== 'boolean')) return false;
  }
  const entries = state.orderRiskReservations;
  if (entries != null && (typeof entries !== 'object' || Array.isArray(entries))) return false;
  for (const [id, entry] of Object.entries(entries || {})) {
    if (entry && ['released', 'reflectedInPositions', 'countedIntraday', 'imported'].some(
      key => entry[key] !== undefined && typeof entry[key] !== 'boolean')) return false;
    if (entry && ['referencePrice', 'baseQty', 'filledAt'].some(
      key => entry[key] != null && !nonnegative(entry[key]))) return false;
    if (entry?.version != null && (typeof entry.version !== 'string' || !Number.isFinite(Date.parse(entry.version)))) return false;
    if (!entry || entry.id !== id || typeof entry.symbol !== 'string' || !entry.symbol ||
      !nonnegative(entry.notional) || entry.notional === 0 || !nonnegative(entry.createdAt) ||
      entry.createdAt > Date.now() + 5000 || !nonnegative(entry.filledQty) ||
      !['intraday', 'multi_day', 'crypto'].includes(entry.category) ||
      !['pending', 'uncertain', 'accepted', 'new', 'pending_new', 'accepted_for_bidding', 'partially_filled',
        'filled', 'canceled', 'expired', 'rejected', 'done_for_day', 'pending_cancel', 'pending_replace', 'replaced', 'stopped', 'suspended', 'calculated'].includes(entry.status)) return false;
  }
  return true;
}
export function readSafetyJournal(file) {
  if (!fs.existsSync(file)) return {};
  try {
    if (fs.statSync(file).size > maxBytes) throw new Error('Safety journal oversized');
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (value.version !== 1 || !validSafetyState(value.state)) throw new Error('Invalid safety journal');
    return value.state;
  } catch {
    return { safetyReconciliationRequired: true };
  }
}
export function createSafetyJournal(file, state) {
  let lastJson = null;
  return function persistSafety() {
    const snapshot = Object.fromEntries(fields.map((key) => [key, state[key]]));
    const json = JSON.stringify({ version: 1, state: snapshot });
    if (json === lastJson) return;
    try {
      if (Buffer.byteLength(json) > maxBytes) throw new Error('Safety journal capacity exceeded');
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const temporary = `${file}.tmp`;
      const fd = fs.openSync(temporary, 'w');
      try { fs.writeFileSync(fd, json); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      fs.renameSync(temporary, file);
      lastJson = json;
    } catch (error) {
      state.safetyReconciliationRequired = true;
      throw error;
    }
  };
}
