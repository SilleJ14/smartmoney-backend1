import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { calculateDynamicTradeAmount } from '../risk/positionSizing.js';
import { createOrderRiskReservations } from '../risk/orderRiskReservations.js';
import { createOrderService } from '../execution/orderService.js';
import { evaluatePreTradeRisk } from '../risk/preTradeRiskGate.js';
import { evaluateLiveTradeLimits } from '../risk/liveTradeLimits.js';
import { createSafetyJournal, readSafetyJournal } from '../state/safetyJournal.js';
import { loadPersistedEngineState } from '../state/loadEngineState.js';
import { createAssetQuotePump } from '../market-data/assetQuotePump.js';

const base = { account: { equity: 10000, cash: 9000, buying_power: 9000 }, positions: [],
  config: { maxBotExposurePercent: 20, minAutonomousTradeAmount: 25 }, getExposure: () => 500, signalScore: 80 };
test('AI sizing is a conviction share of the full REMAINING cap, independent of legacy slot count', () => {
  assert.equal(calculateDynamicTradeAmount(base), 450); // (2000 - 500) * .30
  assert.equal(calculateDynamicTradeAmount({ ...base, config: { ...base.config, targetCapitalSlots: 100 } }), 450);
  assert.equal(calculateDynamicTradeAmount({ ...base, signalScore: 65 }), 225);
  assert.equal(calculateDynamicTradeAmount({ ...base, signalScore: 92 }), 750);
});
test('sizing cannot treat explicit zero cash, BP, exposure cap or compounded remainder as missing', () => {
  assert.equal(calculateDynamicTradeAmount({ ...base, account: { ...base.account, buying_power: 0 } }), 0);
  assert.equal(calculateDynamicTradeAmount({ ...base, account: { ...base.account, cash: 0 } }), 0);
  assert.equal(calculateDynamicTradeAmount({ ...base, account: { ...base.account, stale: true } }), 0);
  assert.equal(calculateDynamicTradeAmount({ ...base, config: { ...base.config, maxBotExposurePercent: 0 } }), 0);
  assert.equal(calculateDynamicTradeAmount({ ...base, compoundingState: { remainingCompoundedBudget: 0 } }), 0);
});
function reservationHarness() {
  const state = { liveTradeLimitState: { dateKey: '2026-09-07', intradayStockEntriesToday: 0, positionIntents: {} } };
  const orders = new Map(), persisted = [];
  const ledger = createOrderRiskReservations({ state, normalizeSymbol: String,
    persist: () => persisted.push(structuredClone(state)),
    lookupOrder: async id => { if (!orders.has(id)) throw new Error('offline'); return orders.get(id); } });
  const reserve = (id, symbol = 'BTC/USD', version = 'v1') => ledger.reserve({ client_order_id: id, symbol }, {
    riskNotional: 100, riskReferencePrice: 100, riskBaseQty: 0, riskDecisionVersion: version, holdCategory: 'crypto',
    liveTradeLimitDecision: { isExistingPosition: false } });
  return { state, orders, ledger, reserve, persisted };
}
test('pending and ambiguous orders persist capital and category capacity before broker positions appear', async () => {
  const h = reservationHarness();
  for (const [id, symbol] of [['1', 'BTC/USD'], ['2', 'ETH/USD'], ['3', 'SOL/USD']]) h.reserve(id, symbol).settle({ error: new Error('timeout') });
  assert.equal(await h.ledger.reconcile([]), 300);
  assert.equal(h.ledger.consumed('BTC/USD', 'v1'), 100);
  assert.equal(h.ledger.consumed('BTC/USD', 'v2'), 0);
  assert.equal(evaluateLiveTradeLimits({ symbol: 'AVAX/USD', isCrypto: true, positionIntents: h.state.liveTradeLimitState.positionIntents }).approved, false);
  assert.ok(h.persisted.length >= 6);
});
test('filled order budget is released only after positions reflect it, while approval remains consumed', async () => {
  const h = reservationHarness();
  h.reserve('1').settle({ result: { status: 'filled', filled_qty: '1' } });
  h.orders.set('1', { symbol: 'BTC/USD', status: 'filled', filled_qty: '1' });
  assert.equal(await h.ledger.reconcile([]), 100);
  assert.equal(await h.ledger.reconcile([{ symbol: 'BTC/USD', qty: '1' }]), 0);
  assert.equal(await h.ledger.reconcile([]), 0, 'a later sale must not re-reserve an already reconciled fill');
  assert.equal(h.ledger.consumed('BTC/USD', 'v1'), 100);
  await assert.rejects(h.ledger.reconcile(Object.assign([], { stale: true })), /Fresh broker/);
});
test('broker-confirmed cancelled unfilled orders release budget; unknown orders do not', async () => {
  const h = reservationHarness(); h.reserve('1'); h.reserve('2', 'ETH/USD');
  h.orders.set('1', { symbol: 'BTC/USD', status: 'canceled', filled_qty: '0' });
  assert.equal(await h.ledger.reconcile([]), 100);
  assert.equal(h.ledger.consumed('BTC/USD', 'v1'), 0);
});
test('two pending fills cannot both claim the same one-share position snapshot', async () => {
  const h = reservationHarness();
  for (const id of ['1', '2']) {
    h.reserve(id).settle({ result: { status: 'filled', filled_qty: '1' } });
    h.orders.set(id, { symbol: 'BTC/USD', status: 'filled', filled_qty: '1' });
  }
  assert.equal(await h.ledger.reconcile([{ symbol: 'BTC/USD', qty: '1' }]), 200);
  assert.equal(await h.ledger.reconcile([{ symbol: 'BTC/USD', qty: '2' }]), 0);
});
test('buy submissions serialize guard+reservation+POST and cannot POST if durable reservation fails', async () => {
  const events = []; let busy = 0;
  const service = createOrderService({ normalizeSymbol: String,
    preTradeRiskGuard: { async assertAllowed(order) { assert.equal(busy, 0); busy++; events.push('guard:' + order.symbol); } },
    reserveRisk: async order => { events.push('reserve:' + order.symbol); return { settle() { busy--; } }; },
    tradingRequest: async (_, options) => { const order = JSON.parse(options.body); events.push('post:' + order.symbol); await Promise.resolve(); return { id: order.symbol }; },
  });
  await Promise.all(['BTC/USD', 'ETH/USD'].map(symbol => service.cryptoMarketBuy({ symbol, dollars: 25 })));
  assert.deepEqual(events, ['guard:BTC/USD', 'reserve:BTC/USD', 'post:BTC/USD', 'guard:ETH/USD', 'reserve:ETH/USD', 'post:ETH/USD']);
  let posts = 0;
  const blocked = createOrderService({ normalizeSymbol: String, reserveRisk() { throw new Error('Disk unavailable'); }, tradingRequest() { posts++; } });
  await assert.rejects(blocked.cryptoMarketBuy({ symbol: 'BTC/USD', dollars: 25 }), /Disk unavailable/);
  assert.equal(posts, 0);
});
test('risk gate rejects reserved cash and stale snapshots without blocking sells', () => {
  const context = { account: { equity: 1000, cash: 100, buying_power: 100 }, positions: [],
    realCashTradingUnlocked: true, autoTradingEnabled: true, isCrypto: true, price: 100,
    quoteAgeSeconds: 0, quoteIsLive: true, spreadAvailable: true, spreadPercent: .1, maxExposurePercent: 100,
    pendingOrderNotional: 80 };
  const order = { symbol: 'BTC/USD', side: 'buy', notional: 50 };
  assert.ok(evaluatePreTradeRisk({ order, context }).reasons.some(reason => reason.includes('cash')));
  assert.equal(evaluatePreTradeRisk({ order, context: { ...context, safetyReconciliationRequired: true } }).approved, false);
  assert.equal(evaluatePreTradeRisk({ order: { ...order, side: 'sell' }, context: { ...context, safetyReconciliationRequired: true } }).approved, true);
});
test('safety journal independently restores daily locks and pending reservations across restart', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sm-safety-'));
  try {
    const file = path.join(directory, 'state.safety.json');
    const state = { dailyLossLocked: true, dailyDateKey: '2026-09-07', orderRiskReservations: { one: {
      id: 'one', symbol: 'AAPL', notional: 200, category: 'intraday', createdAt: Date.now(), filledQty: 0, status: 'pending'
    } }, liveTradeLimitState: { intradayStockEntriesToday: 2 } };
    createSafetyJournal(file, state)();
    assert.equal(readSafetyJournal(file).dailyLossLocked, true);
    assert.equal(readSafetyJournal(file).liveTradeLimitState.intradayStockEntriesToday, 2);
    assert.equal(readSafetyJournal(file).orderRiskReservations.one.notional, 200);
    fs.writeFileSync(file, '{');
    assert.equal(readSafetyJournal(file).safetyReconciliationRequired, true);
    const largeState = path.join(directory, 'empty.json'); fs.writeFileSync(largeState, '');
    assert.equal(loadPersistedEngineState(largeState).safetyReconciliationRequired, true);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
test('crypto can refresh repeatedly while one stock provider job remains pending', async () => {
  const pump = createAssetQuotePump(), seen = []; let release;
  const stock = pump('stock', () => new Promise(resolve => { release = resolve; }), rows => seen.push(...rows));
  const nextStock = pump('stock', async () => ['new-stock'], rows => seen.push(...rows));
  await pump('crypto', async () => ['crypto1'], rows => seen.push(...rows));
  await pump('crypto', async () => ['crypto2'], rows => seen.push(...rows));
  assert.deepEqual(seen, ['crypto1', 'crypto2']);
  release(['stock']); await stock; await nextStock;
  assert.deepEqual(seen, ['crypto1', 'crypto2', 'stock', 'new-stock']);
});
