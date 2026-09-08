export function calculateDynamicTradeAmount({ account = {}, positions = [], signalScore = 80, config = {}, compoundingState = {}, getExposure }) {
  const cash = Number(account.cash || 0);
  const equity = Number(account.equity || 0);
  const buyingPower = Number(account.buying_power || cash || 0);
  if (cash <= 0 || equity <= 0) return 0;
  const minimum = Number(config.minAutonomousTradeAmount || config.eliteConcentrationMinTradeAmount || 25);
  const slots = Math.max(1, Number(config.targetCapitalSlots || 15));
  const budget = Number(compoundingState.compoundedBotBudget || equity * (Number(config.maxBotExposurePercent || 0) / 100));
  const remaining = Math.max(0, budget - getExposure(positions));
  const compoundedRemaining = Number(compoundingState.remainingCompoundedBudget || 0);
  const available = Math.min(compoundedRemaining > 0 ? Math.min(remaining, compoundedRemaining) : remaining, cash, buyingPower || cash);
  if (available < minimum) return 0;
  const multiplier = signalScore >= 90 ? 1.35 : signalScore >= 85 ? 1.15 : signalScore >= 78 ? 1 : signalScore >= 72 ? 0.85 : signalScore >= 70 ? 0.7 : 0;
  if (multiplier <= 0) return 0;
  return Number(Math.min(Math.max(minimum, (budget / slots) * multiplier), available).toFixed(2));
}
