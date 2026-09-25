// A sharp BTC decline cuts the live order size by half. It does not change F.
// A missing BTC tape is unavailable. It is not a decline and it is not a cut.

export const BTC_REGIME_SHADOW = Object.freeze({
  affectsF: false,
  affectsSetup: false,
  affectsX: false,
  productionEffect: true,
  sharpDeclineMultiplier: 0.5,
  multiplierStatus: "LIVE_UNVALIDATED",
});

export function buildBtcRegime(btc = {}) {
  const base = {
    affectsF: false,
    affectsSetup: false,
    affectsX: false,
    productionEffect: true,
  };
  if (!btc || btc.available !== true) {
    return {
      ...base,
      available: false,
      oneHourReturn: null,
      below20BarAverage: null,
      state: "DATA_UNAVAILABLE",
      suggestedRiskMultiplier: null,
      multiplierStatus: "NOT_MEASURED",
    };
  }
  const oneHourReturn = Number.isFinite(Number(btc.oneHourReturn ?? btc.changePercent))
    ? Number(btc.oneHourReturn ?? btc.changePercent)
    : null;
  const below20BarAverage = btc.below20BarAverage === true || btc.belowEma20 === true;
  if (btc.block === true) {
    return {
      ...base,
      available: true,
      oneHourReturn,
      below20BarAverage: true,
      state: "SHARP_DECLINE",
      suggestedRiskMultiplier: BTC_REGIME_SHADOW.sharpDeclineMultiplier,
      multiplierStatus: BTC_REGIME_SHADOW.multiplierStatus,
    };
  }
  return {
    ...base,
    available: true,
    oneHourReturn,
    below20BarAverage,
    state: "NORMAL",
    suggestedRiskMultiplier: null,
    multiplierStatus: "NO_SHADOW_ADJUSTMENT",
  };
}

export function buildBtcRegimeOutcome(signal = {}, { proposedSize = null, recordedAt = null } = {}) {
  const regime = signal.btcRegime || buildBtcRegime(signal.btc || signal.btcMarketContext);
  const size = Number(proposedSize);
  const proposed = Number.isFinite(size) && size > 0 ? size : null;
  const multiplier = regime.suggestedRiskMultiplier;
  return {
    symbol: signal.symbol || null,
    recordedAt,
    btcState: regime.state,
    btcOneHourReturn: regime.oneHourReturn,
    btcBelow20BarAverage: regime.below20BarAverage,
    setup: signal.cryptoSetup?.route || signal.setup?.route || null,
    coinF: Number.isFinite(Number(signal.cryptoDecisionScore))
      ? Number(signal.cryptoDecisionScore)
      : Number.isFinite(Number(signal.legacyCryptoF))
        ? Number(signal.legacyCryptoF)
        : null,
    executionState: signal.cryptoAnalyticalShadow?.X?.state || signal.executionState || null,
    proposedSize: proposed,
    shadowBtcAdjustedSize: proposed !== null && multiplier !== null ? Number((proposed * multiplier).toFixed(2)) : null,
    liveSize: proposed === null ? null : applyLiveBtcSize(proposed, regime).amount,
    forwardReturns: { m5: null, m15: null, m30: null, m60: null },
    maximumFavorableExcursion: null,
    maximumAdverseExcursion: null,
    status: "AWAITING_FORWARD_RETURN",
    productionEffect: true,
  };
}

export function applyLiveBtcSize(amount, regime) {
  const size = Number(amount);
  if (!Number.isFinite(size) || size <= 0) {
    return { amount: 0, applied: false, reason: "SIZE_NOT_POSITIVE" };
  }
  if (!regime || regime.available !== true || regime.state !== "SHARP_DECLINE") {
    return {
      amount: size,
      applied: false,
      reason: regime?.state === "DATA_UNAVAILABLE" ? "BTC_TAPE_UNAVAILABLE" : "NO_BTC_ADJUSTMENT",
    };
  }
  const multiplier = Number(regime.suggestedRiskMultiplier);
  if (!(multiplier > 0)) return { amount: size, applied: false, reason: "BTC_MULTIPLIER_UNAVAILABLE" };
  return {
    amount: Number((size * multiplier).toFixed(2)),
    applied: true,
    multiplier,
    reason: "BTC_SHARP_DECLINE",
  };
}
