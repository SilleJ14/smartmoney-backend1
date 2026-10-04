import { buildCryptoLimitBuyOrder } from '../../execution/cryptoLimitOrder.js';

// Test-only Alpaca crypto asset increments (decimal strings, as Alpaca sends).
export const TEST_CRYPTO_ASSET = Object.freeze({
  class: 'crypto', status: 'active', tradable: true,
  price_increment: '0.01', min_trade_increment: '0.000000001', min_order_size: '0.000001',
});

// What the production pre-trade guard returns for a crypto buy intent: a
// qty-based IOC limit capped 0.5% above the ask it verified.
export function testCryptoLimitOrder(order = {}, { ask = 100, asset = {} } = {}) {
  return buildCryptoLimitBuyOrder({ symbol: order.symbol, notional: order.notional, ask,
    asset: { ...TEST_CRYPTO_ASSET, symbol: order.symbol, ...asset }, clientOrderId: order.client_order_id });
}
