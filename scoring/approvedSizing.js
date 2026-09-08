// Only amounts from the current decision may authorize sizing. Research/raw
// estimates and previous starter orders are deliberately not fallbacks.
export function getApprovedTradeAmount(signal = {}) {
  if (signal.sizingDecisionUpdatedAt && signal.sizingDecisionUpdatedAt !== signal.decisionUpdatedAt) return 0;
  const values = [signal.finalApprovedTradeAmount, signal.finalTradeAmount,
    signal.recommendedTradeAmount, signal.finalSizingReconciliation?.finalTradeAmount];
  const supplied = values.filter((value) => value !== null && value !== undefined && value !== "");
  if (supplied.some((value) => !Number.isFinite(Number(value)) || Number(value) <= 0)) return 0;
  return supplied.length ? Math.min(...supplied.map(Number)) : 0;
}

export function isSizingRevoked(signal = {}) {
  if (signal.sizingDecisionUpdatedAt && signal.sizingDecisionUpdatedAt !== signal.decisionUpdatedAt) return true;
  return [signal.finalApprovedTradeAmount, signal.finalTradeAmount, signal.recommendedTradeAmount,
    signal.finalSizingReconciliation?.finalTradeAmount].some((value) =>
    value !== null && value !== undefined && value !== "" &&
    (!Number.isFinite(Number(value)) || Number(value) <= 0));
}
