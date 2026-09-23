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
    return { locked: true, remainingPercent: 0, reason: "NO_DAY_START" };
  }
  const tradingPnl = current - start;
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
  if (!(peak > 0) || !Number.isFinite(current) || current <= 0) return { locked: true, reason: "INVALID_EQUITY" };
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

// The daily session is UTC. On first connection its baseline is the first observed NAV,
// not a reconstructed midnight balance. Existing incident locks require manual review.
export function updateEquityBaselines(ledger, account, transactions, now) {
  const key = account.id;
  const date = new Date(now).toISOString().slice(0, 10);
  const cursor = String(account.lastTransactionID || "0");
  const after = (id, previous) => /^\d+$/.test(String(id)) && /^\d+$/.test(String(previous)) && BigInt(id) > BigInt(previous);
  let day = ledger.dayStart[key];
  const cashRows = transactions.filter((row) => row.type === "TRANSFER_FUNDS"
    && !after(row.id, cursor) && Number.isFinite(Number(row.amount)));
  const peakCursor = ledger.peakCashFlowCursor?.[key] || day?.cursor || cursor;
  const peakCash = cashRows.filter((row) => after(row.id, peakCursor)).reduce((sum, row) => sum + Number(row.amount), 0);
  if (!day || day.date !== date) {
    day = { date, equity: account.NAV, adjustedEquity: account.NAV, at: new Date(now).toISOString(), cursor };
  } else {
    const cash = cashRows.filter((row) => after(row.id, day.cursor || cursor)).reduce((sum, row) => sum + Number(row.amount), 0);
    day.adjustedEquity = Number(day.adjustedEquity ?? day.equity) + cash;
    day.cursor = cursor;
  }
  ledger.dayStart[key] = day;
  ledger.peakEquity[key] = Math.max(account.NAV, Number(ledger.peakEquity[key] || account.NAV) + peakCash);
  ledger.peakCashFlowCursor ||= {};
  ledger.peakCashFlowCursor[key] = cursor;
  return { dayStartEquity: day.equity, cashFlowAdjustedDayStart: day.adjustedEquity, peakEquity: ledger.peakEquity[key], dailySession: date };
}

// Additional loss from current executable price to stop. NAV already includes unrealized P/L.
// This estimate excludes slippage/gaps and unquoted future fees; missing inputs stay unknown.
export function openStopRisk({ trades = [], prices = [], homeConversions = [], accountCurrency, equity }) {
  if (!(Number(equity) > 0)) return { amount: null, percent: null, known: false };
  let amount = 0;
  for (const trade of trades) {
    const units = Number(trade.currentUnits);
    if (units === 0) continue;
    const price = prices.find((row) => row.instrument === trade.instrument);
    const stop = Number(trade.stopLossOrder?.price ?? trade.guaranteedStopLossOrder?.price);
    const mark = Number(units > 0 ? price?.bid : price?.ask);
    const currency = String(trade.instrument).split("_")[1];
    const conversion = homeConversions.find((row) => row.currency === currency);
    const factor = currency === accountCurrency ? 1 : Number(conversion?.accountLoss);
    if (!Number.isFinite(units) || !(stop > 0) || !(mark > 0) || !(factor > 0) || !Number.isFinite(factor)) {
      return { amount: null, percent: null, known: false };
    }
    amount += Math.max(0, units > 0 ? mark - stop : stop - mark) * Math.abs(units) * factor;
  }
  return { amount, percent: amount / Number(equity) * 100, known: true };
}
