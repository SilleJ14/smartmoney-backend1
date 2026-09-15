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
