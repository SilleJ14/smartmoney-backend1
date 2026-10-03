import test from 'node:test';
import assert from 'node:assert/strict';
import { createOrderRiskReservations } from '../risk/orderRiskReservations.js';
test('canceled buy with missing fill quantity remains reserved across reconciliation and restart', async () => {
  const state = {orderRiskReservations:{id:{id:'id',symbol:'AAPL',notional:25,status:'uncertain'}},liveTradeLimitState:{}};
  let filled;
  const build = () => createOrderRiskReservations({state,persist(){},normalizeSymbol:String,
    lookupOrder:async()=>({symbol:'AAPL',status:'canceled',filled_qty:filled})});
  await build().reconcile([]);
  assert.notEqual(state.orderRiskReservations.id.released,true);
  filled=null; await build().reconcile([]);
  assert.notEqual(state.orderRiskReservations.id.released,true);
  filled='0'; await build().reconcile([]);
  assert.equal(state.orderRiskReservations.id.released,true);
});

test('a buy the broker never received is released only after the grace period', async () => {
  let clock = 1_000_000;
  const state = { orderRiskReservations: { id: { id: 'id', symbol: 'AAPL', notional: 25, status: 'uncertain', createdAt: clock, filledQty: 0 } },
    liveTradeLimitState: {} };
  const notFound = Object.assign(new Error('order not found'), { status: 404 });
  const build = () => createOrderRiskReservations({ state, persist() {}, normalizeSymbol: String, now: () => clock,
    lookupOrder: async () => { throw notFound; } });
  await build().reconcile([]);
  assert.notEqual(state.orderRiskReservations.id.released, true, 'a fresh 404 may be broker propagation delay');
  clock += 61_000;
  await build().reconcile([]);
  assert.equal(state.orderRiskReservations.id.released, true);
  assert.equal(state.orderRiskReservations.id.status, 'not_found');
});

test('an observed fill is never released by a later 404', async () => {
  const state = { orderRiskReservations: { id: { id: 'id', symbol: 'AAPL', notional: 25, status: 'uncertain', createdAt: 0, filledQty: 2 } },
    liveTradeLimitState: {} };
  await createOrderRiskReservations({ state, persist() {}, normalizeSymbol: String, now: () => 10_000_000,
    lookupOrder: async () => { throw Object.assign(new Error('missing'), { status: 404 }); } }).reconcile([]);
  assert.notEqual(state.orderRiskReservations.id.released, true);
});

test('an Alpaca 422 rejection releases the reservation', () => {
  const state = { liveTradeLimitState: { dateKey: 'd' } };
  const reservations = createOrderRiskReservations({ state, persist() {}, normalizeSymbol: String });
  const pending = reservations.reserve({ client_order_id: 'c1', symbol: 'AAPL', side: 'buy' }, { riskNotional: 25, holdCategory: 'multi_day' });
  pending.settle({ error: Object.assign(new Error('qty must be > 0'), { status: 422 }) });
  assert.equal(state.orderRiskReservations.c1.released, true);
});
