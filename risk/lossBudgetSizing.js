function number(value, fallback) {
  if (value == null || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : NaN;
}

// Estimated adverse-move budget, NOT a guaranteed maximum loss (gaps and fills
// can exceed a stop). Pending orders consume risk just like filled positions.
export function calculateLossBudgetSizing({ account = {}, positions = [], config = {},
  signal = {}, dailyStartEquity, pendingNotional = 0 } = {}) {
  const equity = number(account.equity, NaN);
  const startEquity = number(dailyStartEquity, number(account.last_equity, equity));
  const dailyLimit = number(config.dailyLossLimitPercent, 2);
  const perTradeLimit = number(config.maxRiskPerTradePercent, 0.5);
  const pending = number(pendingNotional, 0);
  const configStop = Math.abs(number(config.stopLossPercent, 2));
  const hardStop = Math.abs(number(config.liveHardStopPercent, 3.5));
  // Existing adaptive exits can allow a wider 6% stop. Never size against a
  // tighter assumed stop than the manager may actually use.
  const fallbackStop = Math.max(configStop, hardStop, 6);
  const price = number(signal.price ?? signal.current ?? signal.livePrice, null);
  const explicitStop = number(signal.stopPrice ?? signal.stopLossPrice, null);
  if (explicitStop !== null && (!(price > 0) || !(explicitStop > 0) || explicitStop >= price)) {
    return { approved: false, maxNotional: 0, reason: 'INVALID_LONG_STOP_PLAN' };
  }
  const stopPercent = Math.max(fallbackStop, explicitStop !== null ? (price - explicitStop) / price * 100 : 0);
  const costPercent = number(config.riskExecutionBufferPercent, 0.25);
  const riskFraction = (stopPercent + costPercent) / 100;
  if (![equity, startEquity, dailyLimit, perTradeLimit, pending, configStop, hardStop, costPercent, riskFraction].every(Number.isFinite) ||
    equity <= 0 || startEquity <= 0 || dailyLimit <= 0 || perTradeLimit <= 0 || pending < 0 ||
    configStop <= 0 || hardStop <= 0 || costPercent < 0 || riskFraction <= 0 || riskFraction >= 1 || !Array.isArray(positions)) {
    return { approved: false, maxNotional: 0, reason: 'INVALID_LOSS_BUDGET_EVIDENCE' };
  }
  let openRisk = pending * ((fallbackStop + costPercent) / 100);
  let symbolRisk = 0;
  for (const position of positions) {
    const value = Math.abs(number(position.market_value, NaN));
    if (!Number.isFinite(value)) return { approved: false, maxNotional: 0, reason: 'INVALID_POSITION_RISK_EVIDENCE' };
    const reserved = value * ((fallbackStop + costPercent) / 100);
    openRisk += reserved;
    if (String(position.symbol).replace(/[/-]/g, '') === String(signal.symbol).replace(/[/-]/g, '')) symbolRisk += reserved;
  }
  const dailyLoss = Math.max(0, startEquity - equity);
  const dailyRoom = Math.max(0, startEquity * dailyLimit / 100 - dailyLoss - openRisk);
  const perTradeRisk = Math.max(0, equity * perTradeLimit / 100 - symbolRisk);
  const riskDollars = Math.min(perTradeRisk, dailyRoom);
  const maxNotional = Math.floor(riskDollars / riskFraction * 100) / 100;
  return { approved: maxNotional > 0, maxNotional, riskDollars, dailyLoss,
    dailyRoom, openRisk, symbolRisk, stopPercent, costPercent,
    basis: 'STOP_DISTANCE_AND_REMAINING_DAILY_LOSS_BUDGET',
    reason: maxNotional > 0 ? 'RISK_BUDGET_AVAILABLE' : 'NO_REMAINING_LOSS_BUDGET' };
}
