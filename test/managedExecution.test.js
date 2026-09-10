import test from 'node:test';
import assert from 'node:assert/strict';
import { createManagedExecution } from '../execution/managedExecution.js';
import { createOrderService } from '../execution/orderService.js';
import { readFileSync } from 'node:fs';

function fixture({ qty = 10, symbol = 'ABC', state = {}, managed = [symbol] } = {}) {
  let current = qty ? [{ symbol, qty: String(qty), avg_entry_price: '100', current_price: '105' }] : [];
  const orders = new Map(); const calls = []; const fills = []; const flats = []; const snapshots = [];
  let cancelStatus = 'canceled'; let failure = null;
  const request = async (path, options = {}) => {
    calls.push({ path, ...options });
    if (failure) throw failure;
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
  const service = createOrderService({ tradingRequest: request, normalizeSymbol: s => s, executionLifecycle: life,
    isCrypto: s => s.includes('USD'), preTradeRiskGuard: { assertAllowed: async () => ({ assertCurrent() {} }) } });
  return { state, life, build, service, orders, calls, fills, flats, snapshots,
    positions: value => { current = value; }, cancel: value => { cancelStatus = value; }, fail: value => { failure = value; } };
}

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
  assert.match(server, /executionLifecycle: managedExecution/);
  assert.match(server, /reconcileManagedExecution/);
  assert.match(server, /if \(exit\.fillConfirmed !== true \|\| !exit\.executionId\) return/);
  assert.match(server, /!String\(order\.client_order_id \|\| ''\)\.startsWith\('SM_PROTECT_'\)/);
});
