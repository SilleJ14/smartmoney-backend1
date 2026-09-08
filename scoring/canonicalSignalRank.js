function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function isCryptoSignal(signal = {}) {
  const symbol = String(signal.symbol || "").toUpperCase();
  return signal.assetClass === "crypto" || signal.assetType === "crypto" ||
    symbol.includes("/") || symbol.endsWith("USD");
}

export function getCanonicalFinalScore(signal = {}) {
  if (isCryptoSignal(signal)) {
    const score = finite(
      signal.cryptoDecisionScore ??
      signal.masterFinalScore ??
      signal.finalAutonomousDecisionScore ??
      signal.centralAutonomousDecisionCore?.cryptoDecisionScore
    );
    const available = signal.cryptoDecisionScoreAvailable === true ||
      signal.centralAutonomousDecisionCore?.cryptoDecisionEvidence?.coreEvidencePass === true ||
      signal.cryptoScoreTelemetry?.decision?.coreEvidencePass === true;
    return available && score !== null ? score : null;
  }

  const score = finite(
    signal.masterFinalScore ??
    signal.finalAutonomousDecisionScore ??
    signal.stockDecisionScore ??
    signal.decisionScoreTelemetry?.scores?.decision
  );
  const available = signal.stockDecisionScoreAvailable === true ||
    signal.stockDecisionEvidence?.coreEvidencePass === true ||
    signal.centralAutonomousDecisionCore?.stockDecisionEvidence?.coreEvidencePass === true ||
    signal.decisionScoreTelemetry?.stages?.decision?.coreEvidencePass === true;
  return available && score !== null ? score : null;
}

export function hasExplicitTradeApproval(signal = {}) {
  return signal.qualifiedToBuy === true &&
    signal.autoTradeApproved === true &&
    signal.approved === true &&
    signal.backendApproved === true;
}

export function compareCanonicalSignals(left = {}, right = {}) {
  const approvalGap = Number(hasExplicitTradeApproval(right)) - Number(hasExplicitTradeApproval(left));
  if (approvalGap !== 0) return approvalGap;
  const leftFinal = getCanonicalFinalScore(left);
  const rightFinal = getCanonicalFinalScore(right);
  const availabilityGap = Number(rightFinal !== null) - Number(leftFinal !== null);
  if (availabilityGap !== 0) return availabilityGap;
  if (leftFinal !== null && rightFinal !== null && leftFinal !== rightFinal) {
    return rightFinal - leftFinal;
  }
  return Math.abs(Number(right.changePercent || right.percentChange || 0)) -
    Math.abs(Number(left.changePercent || left.percentChange || 0));
}
