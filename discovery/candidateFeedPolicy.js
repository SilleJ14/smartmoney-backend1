// Presentation policy only: never use this to remove positions or outcome records.
export const MIN_STOCK_PRICE = 0.5;

function finite(value) {
  if (value == null || value === '' || typeof value === 'boolean') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function candidateFeedDecision(signal = {}, { minStockPrice = MIN_STOCK_PRICE } = {}) {
  const symbol = String(signal.symbol || '').toUpperCase();
  const crypto = String(signal.assetClass || signal.asset_class || signal.assetType || '').toLowerCase() === 'crypto' ||
    symbol.includes('/') || /-(USD|USDT)$/.test(symbol) || symbol.endsWith('USDT') || (symbol.endsWith('USD') && symbol.length > 5);
  const price = finite(signal.displayPrice || signal.livePrice || signal.price || signal.current || signal.c);
  if (!(price > 0)) return { visible: false, reason: 'MISSING_VALID_PRICE' };
  if (crypto) return { visible: true, reason: 'CRYPTO_NO_UNIT_PRICE_FLOOR' };
  const floor = Math.max(MIN_STOCK_PRICE, finite(minStockPrice) ?? MIN_STOCK_PRICE);
  if (price < floor) return { visible: false, reason: 'STOCK_BELOW_PRICE_FLOOR' };
  const previousClose = finite(signal.previousClose ?? signal.previous_close ?? signal.prevClose ?? signal.pc);
  const measured = signal.changePercentMeasured !== false && signal.dayChangePercentAvailable !== false &&
    signal.changePercentAvailable !== false && signal.percentChangeAvailable !== false;
  const change = previousClose > 0 ? (price / previousClose - 1) * 100 : measured
    ? finite(signal.dayChangePercent ?? signal.changePercent ?? signal.percentChange ?? signal.todaysChangePerc) : null;
  // Unknown is not a decliner. Keep it watchable with an honest unavailable mark;
  // entry approval still belongs to the separate execution gates.
  return { visible: change === null || change >= 0, reason: change === null
    ? 'DAILY_CHANGE_UNAVAILABLE' : change < 0 ? 'NEGATIVE_DAILY_STOCK_CHANGE' : 'STOCK_FEED_ELIGIBLE' };
}

export function migrateStockFloorPreference(config = {}) {
  return Number(config.stockFloorPolicyVersion || 0) >= 1 ? config
    : { ...config, minStockPrice: MIN_STOCK_PRICE, stockFloorPolicyVersion: 1 };
}
