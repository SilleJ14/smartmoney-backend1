import { FOREX_RISK_LIMITS, sizingReference } from "./riskManager.js";

export function currencyExposureKey(instrumentId, side) {
  const [base, quote] = String(instrumentId || "").split("_");
  if (side === "buy") return base;
  return quote;
}

export function dailyLossState({
  accountId,
  equity,
  cashFlowAdjustedDayStart,
  dayStartEquity,
  realizedLoss = 0,
  fees = 0,
  financing = 0,
  unrealizedLossInEquity = true,
  extraStopLossIfHit = 0,
  pendingRisk = 0,
  limits = FOREX_RISK_LIMITS,
} = {}) {
  const start = Number(cashFlowAdjustedDayStart ?? dayStartEquity);
  const current = Number(equity);
  if (!(start > 0) || !(current > 0)) {
    return { locked: false, remainingPercent: limits.dailyLossTriggerPercent, reason: "NO_DAY_START" };
  }
  const tradingPnl = current - start - Number(realizedLoss) * 0;
  const decline = Math.max(0, start - current);
  const declinePercent = (decline / start) * 100;
  const ifStopsHit = decline + Number(extraStopLossIfHit) + Number(fees) + Number(financing) + Number(pendingRisk);
  const ifStopsPercent = (ifStopsHit / start) * 100;
  const locked = ifStopsPercent >= limits.dailyLossTriggerPercent || declinePercent >= limits.dailyLossTriggerPercent;
  return {
    locked,
    dayStartEquity: start,
    currentEquity: current,
    tradingPnl,
    declinePercent,
    remainingPercent: Math.max(0, limits.dailyLossTriggerPercent - ifStopsPercent),
    unrealizedAlreadyInEquity: unrealizedLossInEquity === true,
    reason: locked ? "DAILY_LOSS_LOCK" : null,
  };
}

export function drawdownLock({ peakEquity, equity, maxPercent = FOREX_RISK_LIMITS.drawdownPausePercent }) {
  const peak = Number(peakEquity);
  const current = Number(equity);
  if (!(peak > 0) || !(current > 0)) return { locked: false };
  const dd = ((peak - current) / peak) * 100;
  return { locked: dd >= maxPercent, drawdownPercent: dd, reason: dd >= maxPercent ? "DRAWDOWN_LIMIT" : null };
}

export function remainingDailyRiskPercent(daily) {
  return Number(daily?.remainingPercent || 0);
}

export function referenceForSizing(account) {
  return sizingReference({
    equity: account?.NAV,
    dayStartEquity: account?.dayStartEquity,
    cashFlowAdjustedDayStart: account?.cashFlowAdjustedDayStart,
  });
}

export function gapShockAllowance({ A, weekendGap = false, multiplier = FOREX_RISK_LIMITS.gapShockAtr }) {
  return Number(A || 0) * Number(multiplier) * (weekendGap ? 1 : 0.25);
}
