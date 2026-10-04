import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertCryptoLimitBuyPayload,
  buildCryptoLimitBuyOrder,
  CRYPTO_LIMIT_BUY_POLICY,
  floorToIncrement,
} from '../execution/cryptoLimitOrder.js';
import { createOrderService } from '../execution/orderService.js';
import { createOrderRiskReservations } from '../risk/orderRiskReservations.js';

const btcAsset = { symbol: 'BTC/USD', class: 'crypto', status: 'active', tradable: true,
  price_increment: '1', min_trade_increment: '0.0001', min_order_size: '0.0001' };
const order = (patch = {}) => ({ symbol: 'BTC/USD', notional: 25, ask: 100, clientOrderId: 'SM_AI_CRYPTO_BUY_BTC/USD_1',
  asset: { ...btcAsset, price_increment: '0.01' }, ...patch });

test('policy: marketable IOC limit, capped 0.5% above the ask, qty-based (Alpaca disallows notional on limits)', () => {
  assert.equal(CRYPTO_LIMIT_BUY_POLICY.type, 'limit');
  assert.equal(CRYPTO_LIMIT_BUY_POLICY.timeInForce, 'ioc');
  assert.equal(CRYPTO_LIMIT_BUY_POLICY.maxPriceAboveAskPercent, 0.5);
});

test('limit price is ask x 1.005 rounded DOWN to the price increment and never below the ask', () => {
  const priced = buildCryptoLimitBuyOrder(order());
  assert.equal(priced.ok, true, priced.reasons.join());
  assert.equal(priced.payload.limit_price, '100.50');
  assert.equal(buildCryptoLimitBuyOrder(order({ ask: 100.123 })).payload.limit_price, '100.62'); // 100.623615 -> 100.62
  const btc = buildCryptoLimitBuyOrder(order({ notional: 500, ask: 63215.37, asset: btcAsset }));
  assert.equal(btc.payload.limit_price, '63531'); // 63531.4468 floored to $1
  const pepe = buildCryptoLimitBuyOrder(order({ symbol: 'PEPE/USD', ask: 0.00001234,
    asset: { symbol: 'PEPE/USD', price_increment: '0.00000001', min_trade_increment: '1', min_order_size: '1' } }));
  assert.equal(pepe.payload.limit_price, '0.00001240');
  assert.equal(pepe.payload.qty, '2016129');
  const coarse = buildCryptoLimitBuyOrder(order({ ask: 100.9, asset: { ...btcAsset, price_increment: '5' } }));
  assert.equal(coarse.ok, false);
  assert.deepEqual(coarse.reasons, ['CRYPTO_LIMIT_PRICE_BELOW_ASK']);
});

test('qty is floored to min_trade_increment so the worst-case spend never exceeds the approved amount', () => {
  const priced = buildCryptoLimitBuyOrder(order({ asset: { ...btcAsset, price_increment: '0.01' } }));
  assert.equal(priced.payload.qty, '0.2487'); // 25 / 100.5 = 0.24875.. floored to 0.0001
  assert.ok(priced.maxSpend <= 25);
  assert.equal(priced.maxSpend, 24.99435);
  for (const notional of [1, 7.77, 25, 99.99, 1234.56]) {
    for (const ask of [0.0123, 1.2345, 99.95, 3021.7, 63215.37]) {
      const result = buildCryptoLimitBuyOrder(order({ notional, ask,
        asset: { ...btcAsset, price_increment: '0.000001', min_trade_increment: '0.000000001', min_order_size: '0.000000001' } }));
      if (!result.ok) continue;
      assert.ok(Number(result.payload.qty) * Number(result.payload.limit_price) <= notional + 1e-9, `${notional}@${ask}`);
      assert.ok(Number(result.payload.limit_price) <= ask * 1.005 * (1 + 1e-9), `${notional}@${ask}`);
      assert.ok(Number(result.payload.limit_price) >= ask, `${notional}@${ask}`);
      assert.ok((result.payload.qty.split('.')[1] || '').length <= 9);
    }
  }
});

test('below min_order_size, missing asset increments, or an invalid ask means nothing is priced', () => {
  const tiny = buildCryptoLimitBuyOrder(order({ notional: 1, ask: 63215.37, asset: btcAsset }));
  assert.equal(tiny.ok, false);
  assert.deepEqual(tiny.reasons, ['CRYPTO_ORDER_BELOW_MIN_SIZE']);
  assert.ok(buildCryptoLimitBuyOrder(order({ asset: { ...btcAsset, price_increment: undefined } })).reasons.includes('CRYPTO_PRICE_INCREMENT_UNAVAILABLE'));
  assert.ok(buildCryptoLimitBuyOrder(order({ asset: { ...btcAsset, min_trade_increment: '0' } })).reasons.includes('CRYPTO_MIN_TRADE_INCREMENT_UNAVAILABLE'));
  assert.ok(buildCryptoLimitBuyOrder(order({ asset: { ...btcAsset, min_order_size: null } })).reasons.includes('CRYPTO_MIN_ORDER_SIZE_UNAVAILABLE'));
  assert.ok(buildCryptoLimitBuyOrder(order({ ask: 0 })).reasons.includes('CRYPTO_LIMIT_ASK_UNAVAILABLE'));
  assert.ok(buildCryptoLimitBuyOrder(order({ asset: { ...btcAsset, symbol: 'ETH/USD' } })).reasons.includes('CRYPTO_ASSET_SYMBOL_MISMATCH'));
  assert.ok(buildCryptoLimitBuyOrder(order({ asset: { ...btcAsset, tradable: false } })).reasons.includes('CRYPTO_ASSET_NOT_TRADABLE'));
  assert.ok(buildCryptoLimitBuyOrder(order({ maxPriceAboveAskPercent: 0.6 })).reasons.includes('CRYPTO_LIMIT_CAP_POLICY_INVALID'));
  assert.ok(buildCryptoLimitBuyOrder(order({ clientOrderId: '' })).reasons.includes('CRYPTO_LIMIT_CLIENT_ORDER_ID_MISSING'));
});

test('payload is a qty-based IOC limit with no notional and the original client order id', () => {
  const priced = buildCryptoLimitBuyOrder(order());
  assert.deepEqual(priced.payload, { symbol: 'BTC/USD', qty: '0.2487', side: 'buy', type: 'limit',
    limit_price: '100.50', time_in_force: 'ioc', client_order_id: 'SM_AI_CRYPTO_BUY_BTC/USD_1' });
  assert.equal('notional' in priced.payload, false);
  const intent = { symbol: 'BTC/USD', notional: 25, side: 'buy', client_order_id: 'SM_AI_CRYPTO_BUY_BTC/USD_1' };
  assert.deepEqual(assertCryptoLimitBuyPayload(intent, priced), priced.payload);
  const reject = (patch, pricedPatch = {}) => assert.throws(() => assertCryptoLimitBuyPayload(intent,
    { ...priced, ...pricedPatch, payload: { ...priced.payload, ...patch } }), /CRYPTO_LIMIT_ORDER_REJECTED/);
  reject({ notional: 25 });
  reject({ type: 'market' });
  reject({ time_in_force: 'day' });
  reject({ limit_price: '100.51' });
  reject({ qty: '0.2500' });
  reject({ client_order_id: 'other' });
  reject({ symbol: 'ETH/USD' });
  assert.throws(() => assertCryptoLimitBuyPayload(intent, undefined), /CRYPTO_LIMIT_ORDER_REJECTED/);
  assert.throws(() => assertCryptoLimitBuyPayload(intent, { ok: false, reasons: ['X'] }), /CRYPTO_LIMIT_ORDER_REJECTED/);
});

test('floorToIncrement handles decimal and exponent increments exactly', () => {
  assert.deepEqual(floorToIncrement(100.49999999999999, '0.01'), { value: 100.5, text: '100.50', decimals: 2 });
  assert.equal(floorToIncrement(0.30000000000000004, '0.1').text, '0.3');
  assert.equal(floorToIncrement(1.23456789123, '1e-9').text, '1.234567891');
  assert.equal(floorToIncrement(5, '10').text, '0');
  assert.equal(floorToIncrement(-1, '0.1'), null);
});

test('automated and manual crypto buys post the guard-priced limit; reservation and duplicate guard keep one identity', async () => {
  for (const manual of [false, true]) {
    const posts = [], reserved = [], guarded = [];
    const service = createOrderService({ normalizeSymbol: (s) => String(s).toUpperCase(), clientOrderPrefix: 'SM_AI', now: () => 42,
      duplicateOrderGuard: { reserve: async (payload) => { guarded.push(payload); return () => {}; } },
      preTradeRiskGuard: { assertAllowed: async (intent, options) => {
        assert.equal(options.cryptoPriceProtectedBuy, true);
        assert.equal(intent.notional, 25);
        const priced = buildCryptoLimitBuyOrder({ symbol: intent.symbol, notional: intent.notional, ask: 100,
          asset: { ...btcAsset, price_increment: '0.01' }, clientOrderId: intent.client_order_id });
        options.riskNotional = priced.maxSpend;
        return { cryptoLimitOrder: priced, assertCurrent() {} };
      } },
      reserveRisk: async (payload, options) => { reserved.push({ id: payload.client_order_id, notional: options.riskNotional }); return { settle() {} }; },
      tradingRequest: async (path, options) => { posts.push(JSON.parse(options.body)); return { id: 'mock', status: 'new' }; },
    });
    await service.cryptoMarketBuy({ symbol: 'btc/usd', dollars: 25, manual,
      confirmationId: manual ? '123e4567-e89b-12d3-a456-426614174000' : undefined });
    assert.equal(posts.length, 1);
    assert.equal(posts[0].type, 'limit');
    assert.equal(posts[0].time_in_force, 'ioc');
    assert.equal(posts[0].limit_price, '100.50');
    assert.equal(posts[0].qty, '0.2487');
    assert.equal(posts[0].notional, undefined);
    assert.equal(posts[0].client_order_id, guarded[0].client_order_id);
    assert.equal(posts[0].client_order_id, reserved[0].id);
    assert.ok(reserved[0].notional <= 25);
  }
});

test('a guard limit above the 0.5% ask cap or above the approved amount is never posted', async () => {
  for (const tamper of [{ limit_price: '100.60' }, { qty: '0.3000' }]) {
    let posts = 0;
    const service = createOrderService({ normalizeSymbol: (s) => String(s).toUpperCase(),
      preTradeRiskGuard: { assertAllowed: async (intent) => {
        const priced = buildCryptoLimitBuyOrder({ symbol: intent.symbol, notional: intent.notional, ask: 100,
          asset: { ...btcAsset, price_increment: '0.01' }, clientOrderId: intent.client_order_id });
        return { cryptoLimitOrder: { ...priced, payload: { ...priced.payload, ...tamper } } };
      } },
      tradingRequest: async () => { posts++; return { id: 'x' }; } });
    await assert.rejects(service.cryptoMarketBuy({ symbol: 'BTC/USD', dollars: 25 }), /CRYPTO_LIMIT_ORDER_REJECTED/);
    assert.equal(posts, 0);
  }
});

test('reservations and fill reconciliation work for qty-based IOC limit buys', async () => {
  const state = { liveTradeLimitState: { dateKey: '2026-10-03', positionIntents: {}, intradayStockEntriesToday: 0 } };
  let broker = null, open = [];
  const ledger = createOrderRiskReservations({ state, persist() {}, normalizeSymbol: String,
    getOpenOrders: async () => open, lookupOrder: async () => broker });
  const priced = buildCryptoLimitBuyOrder(order({ notional: 25, ask: 100 }));
  const reservation = ledger.reserve(priced.payload, { riskNotional: priced.maxSpend, riskReferencePrice: priced.limitPrice,
    riskDecisionVersion: 'v1', holdCategory: 'crypto', riskBaseQty: 0, liveTradeLimitDecision: { isExistingPosition: false } });
  assert.ok(state.orderRiskReservations[priced.payload.client_order_id].notional <= 25);
  assert.ok(ledger.consumed('BTC/USD', 'v1') <= 25);
  reservation.settle({ result: { status: 'new', filled_qty: '0' } });
  // IOC partial fill, remainder canceled by Alpaca: exposure = filled qty x fill price.
  broker = { symbol: 'BTC/USD', status: 'canceled', filled_qty: '0.1', filled_avg_price: '100.2' };
  await ledger.reconcile([]);
  const entry = state.orderRiskReservations[priced.payload.client_order_id];
  assert.equal(entry.status, 'filled');
  assert.ok(Math.abs(entry.notional - 10.02) < 1e-9);
  // IOC with no fill: the reservation is released.
  const second = buildCryptoLimitBuyOrder(order({ symbol: 'ETH/USD', clientOrderId: 'SM_AI_CRYPTO_BUY_ETH/USD_2',
    asset: { ...btcAsset, symbol: 'ETH/USD', price_increment: '0.01' } }));
  ledger.reserve(second.payload, { riskNotional: second.maxSpend, riskReferencePrice: second.limitPrice, riskDecisionVersion: 'v2',
    holdCategory: 'crypto', riskBaseQty: 0, liveTradeLimitDecision: { isExistingPosition: false } }).settle({ result: { status: 'new', filled_qty: '0' } });
  broker = { symbol: 'ETH/USD', status: 'canceled', filled_qty: '0' };
  await ledger.reconcile([{ symbol: 'BTC/USD', qty: '0.1' }]);
  assert.equal(state.orderRiskReservations['SM_AI_CRYPTO_BUY_ETH/USD_2'].released, true);
  // An imported open qty-based limit buy is valued at qty x limit_price.
  open = [{ client_order_id: 'external', symbol: 'SOL/USD', asset_class: 'crypto', side: 'buy', qty: '0.5', limit_price: '150.25', status: 'new' }];
  broker = { symbol: 'SOL/USD', status: 'new', filled_qty: '0' };
  await ledger.reconcile([{ symbol: 'BTC/USD', qty: '0.1' }]);
  assert.equal(state.orderRiskReservations.external.notional, 75.125);
});
