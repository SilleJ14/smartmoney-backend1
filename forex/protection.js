export function protectionVerified(trade = {}, expected = {}) {
  const units = Number(trade.currentUnits);
  const expectedUnits = Number(expected.units);
  const stop = trade.stopLossOrder || trade.protectiveStop;
  if (!Number.isFinite(units) || units === 0) return { ok: false, reason: "MISSING_FILL" };
  if (Number.isFinite(expectedUnits) && Math.abs(units) !== Math.abs(expectedUnits)) {
    return { ok: false, reason: "QUANTITY_MISMATCH", units };
  }
  if (!stop || !stop.price) return { ok: false, reason: "MISSING_PROTECTION", units };
  if (expected.stop && Number(stop.price) !== Number(expected.stop)) {
    return { ok: false, reason: "PROTECTION_PRICE_MISMATCH", units };
  }
  return { ok: true, state: "PROTECTION_VERIFIED", units, stopPrice: Number(stop.price), brokerTradeId: trade.id };
}

export function missingProtectionResponse() {
  return {
    blockNewEntries: true,
    attemptRepair: true,
    seekEmergencyClose: true,
    reason: "MISSING_PROTECTION",
  };
}
