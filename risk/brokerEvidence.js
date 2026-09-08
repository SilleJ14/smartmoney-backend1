const numeric = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
export function validBrokerAccount(account) {
  return account && !Array.isArray(account) && numeric(account.equity ?? account.portfolio_value) &&
    Number(account.equity ?? account.portfolio_value) > 0 && numeric(account.cash) && numeric(account.buying_power) &&
    ['crypto_buying_power', 'non_marginable_buying_power'].every(key => account[key] == null || numeric(account[key]));
}
export function validBrokerPositions(positions) {
  return Array.isArray(positions) && positions.every(p => p && typeof p.symbol === 'string' && p.symbol.trim() &&
    numeric(p.qty) && numeric(p.market_value));
}
export function availableBuyingPower(account = {}, crypto = false) {
  const keys = ['cash', 'buying_power', ...(crypto ? ['crypto_buying_power', 'non_marginable_buying_power'] : [])];
  if (!numeric(account.cash) || !numeric(account.buying_power)) return 0;
  const values = keys.filter(key => account[key] != null).map(key => numeric(account[key]) ? Number(account[key]) : NaN);
  return values.some(v => !Number.isFinite(v) || v < 0) ? 0 : Math.min(...values);
}
