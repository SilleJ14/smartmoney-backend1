import { calculateLossBudgetSizing } from './lossBudgetSizing.js';
import { evaluateCryptoTradePlan } from '../scoring/cryptoTradePlan.js';
import { assessCryptoOrderLiquidity } from '../scoring/cryptoOrderLiquidity.js';

export function calculateDynamicTradeAmount({ account = {}, positions = [], signalScore = 80, config = {}, compoundingState = {}, getExposure,
  signal = {}, dailyStartEquity, pendingNotional = 0 }) {
  const cash = Number(account.cash || 0);
  const equity = Number(account.equity || 0);
  const buyingPower = Number(account.buying_power ?? cash);
  if ([account, positions].some(snapshot => snapshot?.snapshotAt != null && (Date.now() - snapshot.snapshotAt > 10000 || snapshot.snapshotAt > Date.now() + 5000))) return 0;
  if (cash <= 0 || equity <= 0) return 0;
  const minimum = Number(config.minAutonomousTradeAmount || config.eliteConcentrationMinTradeAmount || 25);
  const configuredBudget = equity * (Number(config.maxBotExposurePercent || 0) / 100);
  const budget = Math.min(configuredBudget, Number(compoundingState.compoundedBotBudget ?? configuredBudget));
  const remaining = Math.max(0, budget - getExposure(positions));
  const available = Math.min(remaining, Number(compoundingState.remainingCompoundedBudget ?? remaining), cash, buyingPower);
  if (!Number.isFinite(available) || available < minimum || account.stale || positions.stale) return 0;
  // Conviction determines a share of the ENTIRE remaining shared budget. These
  // are allocation fractions, not probabilities or expected returns.
  const fraction = signalScore >= 90 ? 0.5 : signalScore >= 85 ? 0.4 : signalScore >= 78 ? 0.3 : signalScore >= 72 ? 0.2 : signalScore >= 65 ? 0.15 : 0;
  if (!fraction) return 0;
  const lossBudget = calculateLossBudgetSizing({ account, positions, config, signal, dailyStartEquity, pendingNotional });
  let amount = Math.floor(Math.min(Math.max(minimum, available * fraction), available, lossBudget.maxNotional) * 100) / 100;
  if (signal.scoringModelVersion === 'SMARTMONEY_CRYPTO_DECISION_V4') {
    const existing = positions.some(p => String(p.symbol).replaceAll('/', '') === String(signal.symbol).replaceAll('/', ''));
    // A starter is half of the allocation, not half of the whole account.
    if (!existing) amount = Math.min(amount, Math.max(minimum, Math.floor(amount * .5 * 100) / 100));
    const depth = assessCryptoOrderLiquidity(signal.cryptoOrderbook, { symbol: signal.symbol, notional: Math.max(minimum, amount) });
    amount = Math.min(amount, depth.maxNotional);
    const plan = evaluateCryptoTradePlan(signal, { notional: amount });
    signal.cryptoTradePlan = plan;
    if (!plan.approved) return 0;
  }
  // Never round a risk-constrained amount UP to the broker minimum.
  return lossBudget.approved && amount >= minimum ? amount : 0;
}
