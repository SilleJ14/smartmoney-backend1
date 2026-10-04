import test from 'node:test';
import assert from 'node:assert/strict';
import { createManagedExecution } from '../execution/managedExecution.js';
import { createOrderService } from '../execution/orderService.js';
import { readFileSync } from 'node:fs';
import { testCryptoLimitOrder } from './fixtures/cryptoLimitPricing.js';

function fixture({ qty = 10, symbol = 'ABC', state = {}, managed = [symbol], guard = null, serviceNow = undefined } = {}) {
  let current = qty ? [{ symbol, qty: String(qty), avg_entry_price: '100', current_price: '105' }] : [];
  const orders = new Map(); const calls = []; const fills = []; const flats = []; const snapshots = [];
  let cancelStatus = 'canceled'; let failure = null; let postFailure = null;
  const request = async (path, options = {}) => {
    calls.push({ path, ...options });
    if (failure) throw failure;
    if (postFailure && path === '/v2/orders' && options.method === 'POST') throw postFailure;
    if (path === '/v2/positions') return structuredClone(current);
    if (path.startsWith('/v2/assets/')) return { price_increment: '.01' };
    if (path.includes('?status=open')) return [...orders.values()].filter(o => !['filled', 'canceled', 'expired', 'rejected'].includes(o.status)).map(o => ({ ...o }));
    if (path === '/v2/orders' && options.method === 'POST') {
      const payload = JSON.parse(options.body);
      const order = { ...payload, id: `order-${orders.size + 1}`, status: 'new', filled_qty: '0', filled_avg_price: null };
      orders.set(order.id, order); return { ...order };
    }
    const order = path.includes('by_client_order_id')
      ? [...orders.values()].find(o => o.client_order_id === decodeURIComponent(path.split('client_order_id=')[1]))
      : orders.get(path.split('/').at(-1));
    if (!order) throw Object.assign(new Error('Order not found'), { status: 404 });
    if (options.method === 'DELETE') { order.status = cancelStatus; return {}; }
    return { ...order };
  };
  const build = () => createManagedExecution({ state, persist: () => snapshots.push(structuredClone(state)), request,
    getManagedSymbols: async () => managed, getConfig: () => ({}), isCrypto: s => s.includes('USD'),
    onFill: e => fills.push(e), onFlat: e => flats.push(e) });
  const life = build();
  const service = createOrderService({ tradingRequest: request, normalizeSymbol: s => s, executionLifecycle: life, now: serviceNow,
    isCrypto: s => s.includes('USD'), preTradeRiskGuard: guard || { assertAllowed: async () => ({ assertCurrent() {} }) } });
  return { state, life, build, service, orders, calls, fills, flats, snapshots,
    positions: value => { current = value; }, cancel: value => { cancelStatus = value; }, fail: value => { failure = value; },
    failPost: value => { postFailure = value; } };
}

// The production guard's crypto contract, reduced to what the plan lifecycle
// needs: the verified setup's stop, the broker position it saw, and the IOC
// limit it priced (qty-based, capped 0.5% above a $100 ask).
function cryptoPlanFixture() {
  const plan = { stopPrice: 99 };
  const guard = { assertAllowed: async (order, options) => {
    options.cryptoTradePlan = { stopPrice: plan.stopPrice, targetPrice: 110, source: 'CRYPTO_SETUP_V1' };
    options.riskBaseQty = Number(plan.positionQty || 0);
    return { assertCurrent() {}, cryptoLimitOrder: testCryptoLimitOrder(order, { ask: 100 }) };
  } };
  // Distinct client order ids for buys submitted within the same millisecond.
  let clientClock = Date.now();
  const f = fixture({ symbol: 'BTCUSD', qty: 0, guard, serviceNow: () => ++clientClock });
  const buy = async (stopPrice) => {
    plan.stopPrice = stopPrice;
    return f.service.cryptoMarketBuy({ symbol: 'BTCUSD', dollars: 25 });
  };
  const brokerOrder = (id) => f.orders.get(id);
  const stops = () => [...f.orders.values()].filter(o => o.side === 'sell' && o.type === 'stop_limit');
  return { f, plan, buy, brokerOrder, stops, plans: () => f.state.managedExecution.buyPlans || {} };
}

test('an unfilled IOC crypto buy leaves no plan; a later buy of the same coin uses only its new plan', async () => {
  const { f, buy, brokerOrder, stops, plans } = cryptoPlanFixture();
  const first = await buy(99.5); // a stale setup whose stop sits just under the price
  assert.equal(first.type, 'limit'); assert.equal(first.time_in_force, 'ioc');
  assert.equal(plans().BTCUSD.stopPrice, 99.5);
  Object.assign(brokerOrder(first.id), { status: 'canceled', filled_qty: '0' }); // IOC: nothing at or below the cap
  await f.life.reconcile();
  assert.equal(plans().BTCUSD, undefined, 'a terminal zero-fill buy with no position removes its plan');
  const second = await buy(96);
  assert.equal(plans().BTCUSD.stopPrice, 96, 'never max-merged with the unfilled order\'s 99.5 stop');
  Object.assign(brokerOrder(second.id), { status: 'filled', filled_qty: second.qty, filled_avg_price: '100' });
  f.positions([{ symbol: 'BTCUSD', qty: second.qty, avg_entry_price: '100', current_price: '100' }]);
  await f.life.reconcile();
  const [stop] = stops();
  assert.equal(stop.stop_price, '96');
  assert.equal(stop.qty, second.qty);
  assert.equal(plans().BTCUSD.filledQty, Number(second.qty));
});

test('a buy submitted while no position exists replaces a plan whose order has not settled yet', async () => {
  const { f, buy, brokerOrder, stops, plans } = cryptoPlanFixture();
  const first = await buy(99.5); // still "new" at the broker when the next buy is submitted
  const second = await buy(96);
  assert.equal(plans().BTCUSD.stopPrice, 96);
  assert.equal(plans().BTCUSD.clientId, second.client_order_id);
  assert.equal('previousPlan' in plans().BTCUSD, false);
  Object.assign(brokerOrder(first.id), { status: 'canceled', filled_qty: '0' });
  Object.assign(brokerOrder(second.id), { status: 'filled', filled_qty: second.qty, filled_avg_price: '100' });
  f.positions([{ symbol: 'BTCUSD', qty: second.qty, avg_entry_price: '100', current_price: '100' }]);
  await f.life.reconcile();
  assert.equal(stops()[0].stop_price, '96');
});

test('a partially filled IOC keeps its plan, sized to the filled qty, and protects only what filled', async () => {
  const { f, buy, brokerOrder, stops, plans } = cryptoPlanFixture();
  const order = await buy(96);
  assert.equal(plans().BTCUSD.requestedQty, Number(order.qty));
  Object.assign(brokerOrder(order.id), { status: 'canceled', filled_qty: '0.1', filled_avg_price: '100.2' });
  f.positions([{ symbol: 'BTCUSD', qty: '0.1', avg_entry_price: '100.2', current_price: '100.2' }]);
  await f.life.reconcile();
  const kept = plans().BTCUSD;
  assert.equal(kept.stopPrice, 96);
  assert.equal(kept.filledQty, 0.1);
  assert.equal(kept.buyStatus, 'canceled');
  const [stop] = stops();
  assert.equal(stop.qty, '0.1');
  assert.equal(stop.stop_price, '96');
});

test('a scale-in IOC that never fills restores the plan that protected the existing position', async () => {
  const { f, plan, buy, brokerOrder, plans } = cryptoPlanFixture();
  const entry = await buy(96);
  Object.assign(brokerOrder(entry.id), { status: 'filled', filled_qty: entry.qty, filled_avg_price: '100' });
  f.positions([{ symbol: 'BTCUSD', qty: entry.qty, avg_entry_price: '100', current_price: '103' }]);
  await f.life.reconcile();
  plan.positionQty = entry.qty;
  const scaleIn = await buy(98);
  assert.equal(plans().BTCUSD.stopPrice, 98, 'a scale-in into an existing position keeps the higher stop');
  Object.assign(brokerOrder(scaleIn.id), { status: 'expired', filled_qty: '0' });
  await f.life.reconcile();
  assert.equal(plans().BTCUSD.stopPrice, 96);
  assert.equal(plans().BTCUSD.clientId, entry.client_order_id);
});

test('a definitively rejected crypto buy removes its plan; an uncertain outcome keeps it', async () => {
  const { f, buy, plans } = cryptoPlanFixture();
  f.failPost(Object.assign(new Error('insufficient balance'), { status: 403 }));
  await assert.rejects(buy(99.5), /insufficient/);
  assert.equal(plans().BTCUSD, undefined);
  f.failPost(Object.assign(new Error('gateway timeout'), { status: 504 }));
  await assert.rejects(buy(97), /timeout/);
  assert.equal(plans().BTCUSD.stopPrice, 97, 'the POST may have reached Alpaca; keep the plan until reconciled');
});

test('a filled plan whose position was closed outside the ledger is dropped after the grace period', async () => {
  let clock = 1_000_000;
  const state = { managedExecution: { version: 1, orders: {}, realized: {}, completed: [], buyPlans: {
    BTCUSD: { stopPrice: 99, clientId: 'old-buy', symbol: 'BTCUSD', buyTerminal: true, filledQty: 0.1, settledAt: clock } } } };
  const life = createManagedExecution({ state, persist() {}, request: async (path) => {
    if (path === '/v2/positions') return [];
    if (path.includes('?status=open')) return [];
    throw new Error(`unexpected ${path}`);
  }, getManagedSymbols: async () => ['BTCUSD'], getConfig: () => ({}), isCrypto: s => s.includes('USD'), now: () => clock });
  await life.reconcile();
  assert.equal(state.managedExecution.buyPlans.BTCUSD.stopPrice, 99, 'a fill not yet visible as a position keeps its plan');
  clock += 60_000;
  await life.reconcile();
  assert.equal(state.managedExecution.buyPlans.BTCUSD, undefined, 'a later (e.g. manual) entry cannot inherit the stale stop');
});

test('whole shares receive GTC stops; fractional shares receive DAY stops', async () => {
  for (const qty of [10, .4]) {
    const f = fixture({ qty }); await f.life.reconcile();
    const stop = [...f.orders.values()][0];
    assert.equal(stop.type, 'stop'); assert.equal(stop.stop_price, '94');
    assert.equal(stop.qty, String(qty)); assert.equal(stop.time_in_force, qty === 10 ? 'gtc' : 'day');
    assert.doesNotThrow(f.life.assertReady);
    await f.life.reconcile(); assert.equal(f.orders.size, 1);
  }
});
test('crypto uses supported GTC stop-limit protection', async () => {
  const f = fixture({ symbol: 'BTCUSD', qty: .12 }); await f.life.reconcile();
  const stop = [...f.orders.values()][0]; assert.equal(stop.type, 'stop_limit');
  assert.equal(stop.time_in_force, 'gtc'); assert.ok(Number(stop.limit_price) < Number(stop.stop_price));
});
test('a verified crypto structural stop is durable before submission and protects actual fills after restart', async () => {
  const f = fixture({ symbol: 'BTCUSD', qty: 0 });
  f.life.submitting({ side: 'buy', symbol: 'BTCUSD', client_order_id: 'fixture-buy' }, {
    cryptoTradePlan: { stopPrice: 98, targetPrice: 105, source: 'CRYPTO_SETUP_V1' },
  });
  assert.equal(f.snapshots.at(-1).managedExecution.buyPlans.BTCUSD.stopPrice, 98);
  f.positions([{ symbol: 'BTCUSD', qty: '.1', avg_entry_price: '100', current_price: '101' }]);
  await f.build().reconcile();
  assert.equal([...f.orders.values()][0].stop_price, '98');
  assert.equal([...f.orders.values()][0].qty, '0.1');
});
test('never protects positions outside the managed universe', async () => {
  const f = fixture({ managed: [] }); await f.life.reconcile(); assert.equal(f.orders.size, 0);
});
test('sell acceptance does not book profit or clear position state', async () => {
  const f = fixture(); await f.life.reconcile();
  await f.service.stockSell({ symbol: 'ABC', qty: 10, marketOpen: true, fractionable: true });
  assert.equal(f.fills.length, 0); assert.equal(f.flats.length, 0);
  assert.equal([...f.orders.values()][0].status, 'canceled');
  assert.equal([...f.orders.values()][1].type, 'market');
});
test('pending cancellation prevents a second sell and retains uncertain stop', async () => {
  const f = fixture(); await f.life.reconcile(); f.cancel('pending_cancel');
  await assert.rejects(f.service.stockSell({ symbol: 'ABC', qty: 10, marketOpen: true, fractionable: true }), /not confirmed/);
  assert.equal(f.orders.size, 1);
});
test('actual partial fills are incremental and survive a restart without duplication', async () => {
  const f = fixture();
  const order = await f.service.stockSell({ symbol: 'ABC', qty: 10, marketOpen: true, fractionable: true });
  Object.assign(f.orders.get(order.id), { status: 'partially_filled', filled_qty: '3', filled_avg_price: '110' });
  f.positions([{ symbol: 'ABC', qty: '7', avg_entry_price: '100' }]);
  await f.life.reconcile(); assert.equal(f.fills.length, 1); assert.equal(f.flats.length, 0);
  await f.build().reconcile(); assert.equal(f.fills.length, 1);
  Object.assign(f.orders.get(order.id), { status: 'filled', filled_qty: '10', filled_avg_price: '112' });
  f.positions([]); await f.life.reconcile();
  assert.equal(f.fills[1].deltaQty, 7); assert.equal(f.flats.length, 1);
  assert.equal(f.flats[0].proceeds, 1120); assert.equal(f.flats[0].cost, 1000);
  assert.equal(f.flats[0].exitPrice, 112); assert.equal(f.flats[0].fillConfirmed, true);
  await f.life.reconcile(); assert.equal(f.flats.length, 1);
});
test('pending partial trim protects quantity not reserved by the market sell', async () => {
  const f = fixture(); await f.service.stockSell({ symbol: 'ABC', qty: 3, marketOpen: true, fractionable: true });
  await f.life.reconcile();
  const stop = [...f.orders.values()].find(o => o.type === 'stop'); assert.equal(stop.qty, '7');
});
test('canceled partial exits retain their realized fills and protect remaining shares', async () => {
  const f = fixture();
  const order = await f.service.stockSell({ symbol: 'ABC', qty: 10, marketOpen: true, fractionable: true });
  Object.assign(f.orders.get(order.id), { status: 'canceled', filled_qty: '4', filled_avg_price: '90' });
  f.positions([{ symbol: 'ABC', qty: '6', avg_entry_price: '100' }]); await f.life.reconcile();
  assert.equal(f.fills[0].filledQty, 4); assert.equal(f.flats.length, 0);
  assert.equal([...f.orders.values()].find(o => o.type === 'stop').qty, '6');
});
test('broker stop filled during outage is recorded on restart', async () => {
  const f = fixture(); await f.life.reconcile();
  Object.assign([...f.orders.values()][0], { status: 'filled', filled_qty: '10', filled_avg_price: '93' });
  f.positions([]); await f.build().reconcile();
  assert.equal(f.flats.length, 1); assert.equal(f.flats[0].reason, 'BROKER_PROTECTIVE_STOP');
  assert.equal(f.flats[0].proceeds - f.flats[0].cost, -70);
});
test('scale-in replaces stop quantity only after actual position increases', async () => {
  const f = fixture(); await f.life.reconcile();
  f.positions([{ symbol: 'ABC', qty: '12', avg_entry_price: '102' }]); await f.life.reconcile();
  const [first, next] = [...f.orders.values()]; assert.equal(first.status, 'canceled');
  assert.equal(next.qty, '12'); assert.ok(Number(next.stop_price) >= Number(first.stop_price));
});
test('manual close uses the same protected fill-accounting path', async () => {
  const f = fixture(); await f.life.reconcile();
  const order = await f.service.closePosition('ABC'); assert.equal(order.qty, '10');
  assert.equal(f.flats.length, 0); assert.equal(f.state.managedExecution.orders[order.client_order_id].reason, 'MANUAL_CLOSE');
});
test('broker failures block new buys, without inventing protection', async () => {
  const f = fixture(); f.fail(new Error('Broker unavailable'));
  await assert.rejects(f.life.reconcile(), /unavailable/);
  assert.throws(f.life.assertReady); assert.equal(f.state.positionProtection.ok, false);
  await assert.rejects(f.service.stockBuy({ symbol: 'ABC', dollars: 20, marketOpen: true, fractionable: true,
    referencePrice: 100, holdCategory: 'intraday' }), /unavailable/);
  assert.equal(f.orders.size, 0);
});
test('a failed protective stop does not pause new buys when fills are known', async () => {
  const f = fixture();
  f.orders.set('external-sell', { id: 'external-sell', symbol: 'ABC', side: 'sell', status: 'new', filled_qty: '0', filled_avg_price: null });
  await f.life.reconcile();
  assert.equal(f.state.positionProtection.newBuysPaused, false);
  assert.doesNotThrow(f.life.assertReady);
});
test('manual buys still submit when position protection is not ready', async () => {
  const f = fixture({ qty: 0 });
  assert.throws(f.life.assertReady);
  const order = await f.service.manualStockBuy({
    symbol: 'LOBO', dollars: 25, buyMode: 'dollars', fractionable: true,
    marketOpen: false, holdCategory: 'intraday', confirmationId: '11111111-1111-4111-8111-111111111111',
  });
  assert.equal(order.symbol, 'LOBO');
  assert.equal(order.side, 'buy');
});
test('multi-day buys use whole shares; fractional intraday buying stays available', async () => {
  const f = fixture({ qty: 0 });
  const multi = await f.service.stockBuy({ symbol: 'ABC', dollars: 250, marketOpen: true, fractionable: true, referencePrice: 100, holdCategory: 'multi_day' });
  assert.equal(multi.qty, '2'); assert.equal(multi.notional, undefined);
  const day = await f.service.stockBuy({ symbol: 'ABC', dollars: 25, marketOpen: true, fractionable: true, referencePrice: 100, holdCategory: 'intraday' });
  assert.equal(day.notional, 25);
  assert.throws(() => f.service.manualStockBuy({ symbol: 'ABC', shares: .5, buyMode: 'shares', marketOpen: true, fractionable: true, holdCategory: 'multi_day' }), /whole shares/);
});
test('sell intents are persisted before POST and cannot be replayed after timeout', async () => {
  const f = fixture();
  await f.service.stockSell({ symbol: 'ABC', qty: 10, marketOpen: true, fractionable: true });
  assert.ok(f.snapshots.some(s => Object.values(s.managedExecution.orders).some(r => r.status === 'submitting' && !r.orderId)));
  await assert.rejects(f.service.stockSell({ symbol: 'ABC', qty: 10, marketOpen: true, fractionable: true }), /still pending/);
  assert.equal(f.orders.size, 1);
});
test('missing fill quantity cannot be treated as a confirmed unfilled order', async () => {
  const f = fixture(); await f.life.reconcile();
  [...f.orders.values()][0].filled_qty = null;
  await assert.rejects(f.life.reconcile(), /Invalid broker sell/);
  assert.throws(f.life.assertReady);
});
test('legacy sell paths no longer close journals or clear positions on submission', () => {
  const exits = readFileSync(new URL('../risk/positionExitManager.js', import.meta.url), 'utf8');
  assert.doesNotMatch(exits, /journalTradeExit\(symbol|rememberTradeResult\(symbol|delete engineState\.(?:highWaterMarks|aiEntryScores|runnerPositions)/);
  const routes = readFileSync(new URL('../routes/manualExecutionRoutes.js', import.meta.url), 'utf8');
  assert.doesNotMatch(routes, /clearClosedPositionState\(getState/);
  const server = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  assert.match(server, /confidenceBands \|\|\s*typeof engineState\.reinforcementWeightState\.confidenceBands !== "object"/);
  assert.match(server, /reconcileManagedExecution/);
  assert.match(server, /if \(exit\.fillConfirmed !== true \|\| !exit\.executionId\) return/);
  // The pre-close flatten cancels only SM_AI bot orders, never SM_PROTECT_ stops
  // (behaviour covered in preCloseFlatten.test.js).
  assert.match(server, /!cryptoOrder &&\s*isBotOrder\(order\) &&/);
  assert.equal('SM_PROTECT_x'.startsWith('SM_AI'), false);
});

test('a timed-out sell the broker never received stops blocking exits after the grace period', async () => {
  const f = fixture({ qty: 10, managed: [] });
  let clock = 1_000_000;
  const life = createManagedExecution({ state: f.state, persist() {}, request: async (path, options) => {
    if (path === '/v2/positions') return [{ symbol: 'ABC', qty: '10', avg_entry_price: '100' }];
    if (path.includes('?status=open')) return [];
    if (path.includes('by_client_order_id')) throw Object.assign(new Error('Order not found'), { status: 404 });
    throw new Error(`unexpected ${path} ${options?.method || ''}`);
  }, getManagedSymbols: async () => [], getConfig: () => ({}), isCrypto: () => false, now: () => clock });
  const payload = { symbol: 'ABC', side: 'sell', qty: '10', client_order_id: 'SM_AI_SELL_ABC_1' };
  await life.beforeSubmit(payload);
  life.submitting(payload, {}, { avg_entry_price: '100' });
  life.failed({ payload, error: Object.assign(new Error('timeout'), { status: 504 }), submitted: true });
  assert.equal(f.state.managedExecution.orders[payload.client_order_id].status, 'uncertain');
  const next = { symbol: 'ABC', side: 'sell', qty: '10', client_order_id: 'SM_AI_SELL_ABC_2' };
  await assert.rejects(life.beforeSubmit({ ...next }), /not found/, 'inside the grace period the outcome stays unknown');
  clock += 61_000;
  await life.beforeSubmit({ ...next });
  assert.equal(f.state.managedExecution.orders[payload.client_order_id].status, 'not_found');
  await life.reconcile();
  assert.doesNotThrow(life.assertReady);
});
