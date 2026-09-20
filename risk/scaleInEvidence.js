// Additional entry authorization only. Never called by risk-reducing sells.
export function evaluateScaleInEvidence({ symbol, positions = [], reservations = {}, protection, price, notional,
  normalizeSymbol = String, now = Date.now() }) {
  const position = positions.find(p => normalizeSymbol(p.symbol) === normalizeSymbol(symbol));
  if (!position) return { required: false, approved: true, reasons: [] };
  const reasons = [];
  const qty = Number(position.qty), entry = Number(position.avg_entry_price);
  if (positions.stale || !Number.isFinite(qty) || qty <= 0 || !Number.isFinite(entry) || entry <= 0) reasons.push('SCALE_IN_POSITION_UNRECONCILED');
  const checked = Date.parse(protection?.checkedAt || '');
  if (protection?.ok !== true || !Number.isFinite(checked) || now - checked > 15000 || checked > now + 5000) reasons.push('SCALE_IN_PROTECTION_UNCONFIRMED');
  if (Object.values(reservations).some(row => normalizeSymbol(row.symbol) === normalizeSymbol(symbol) && !row.released && !row.reflectedInPositions)) reasons.push('SCALE_IN_UNRESOLVED_ORDER');
  const resultingExposure = qty * Number(price) + Number(notional);
  if (!Number.isFinite(resultingExposure) || resultingExposure <= 0) reasons.push('SCALE_IN_COMBINED_EXPOSURE_UNAVAILABLE');
  return { required: true, approved: reasons.length === 0, reasons, filledQuantity: Number.isFinite(qty) ? qty : null,
    resultingExposure: Number.isFinite(resultingExposure) ? resultingExposure : null,
    riskEvaluation: 'Combined account/bot exposure and remaining loss budget are checked by the shared risk gate' };
}
