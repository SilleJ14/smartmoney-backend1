import test from 'node:test';
import assert from 'node:assert/strict';
import { candidateFeedDecision, migrateStockFloorPreference } from '../discovery/candidateFeedPolicy.js';
import { calculateLossBudgetSizing } from '../risk/lossBudgetSizing.js';
import { calculateDynamicTradeAmount } from '../risk/positionSizing.js';
import { evaluatePreTradeRisk } from '../risk/preTradeRiskGate.js';
import { confirmedBotOwnedSymbols } from '../execution/confirmedOwnership.js';
import { buildPendingExits } from '../execution/brokerReconciliation.js';
import { parseRemoteConfigUpdates } from '../config/remoteConfigUpdates.js';
import { validateQuietLearning } from '../scoring/quietLearningValidation.js';

test('stock floor accepts exactly $0.50 and excludes cheaper stocks', () => {
  assert.equal(candidateFeedDecision({ symbol: 'LOW', price: 0.5, changePercent: 0 }).visible, true);
  assert.equal(candidateFeedDecision({ symbol: 'LOW', price: 0.499, changePercent: 20 }).visible, false);
  assert.equal(parseRemoteConfigUpdates({ minStockPrice: 0.1 }).updates.minStockPrice, 0.5);
});
test('crypto has no unit-price minimum, but zero/invalid prices still fail', () => {
  for (const symbol of ['SHIB/USD', 'SHIBUSD', 'SHIB-USDT']) {
    assert.equal(candidateFeedDecision({ symbol, price: 0.000001, changePercent: -20 }).visible, true);
    assert.equal(candidateFeedDecision({ symbol, price: 0 }).visible, false);
  }
});
test('daily decline wins over intraday recovery and high scores without mutating records', () => {
  const signal = { symbol: 'FALL', price: 9, previousClose: 10, sessionChangePercent: 4, changePercent: 20, masterFinalScore: 95 };
  const before = structuredClone(signal);
  assert.equal(candidateFeedDecision(signal).reason, 'NEGATIVE_DAILY_STOCK_CHANGE');
  assert.deepEqual(signal, before);
  assert.equal(candidateFeedDecision({ ...signal, price: 10.1 }).visible, true);
});
test('missing change is not fabricated into a loss or zero', () => {
  assert.equal(candidateFeedDecision({ symbol: 'MISS', price: 10, changePercent: -4, changePercentAvailable: false }).reason, 'DAILY_CHANGE_UNAVAILABLE');
});
test('floor preference migrates once and preserves other saved settings', () => {
  const old = { minStockPrice: 1, autoTradingEnabled: false, dailyLossLimitPercent: 1 };
  const migrated = migrateStockFloorPreference(old);
  assert.deepEqual(migrated, { ...old, minStockPrice: 0.5, stockFloorPolicyVersion: 1 });
  assert.equal(old.minStockPrice, 1);
  assert.equal(migrateStockFloorPreference({ ...migrated, minStockPrice: 2 }).minStockPrice, 2);
});
const base = { account: { equity: 1000, cash: 1000, buying_power: 1000 }, positions: [],
  signal: { symbol: 'TEST', price: 10 }, dailyStartEquity: 1000,
  config: { maxBotExposurePercent: 80, stopLossPercent: 2, dailyLossLimitPercent: 2 } };
test('risk size falls as stop distance widens and exposes the dollar budget', () => {
  const normal = calculateLossBudgetSizing(base);
  const wide = calculateLossBudgetSizing({ ...base, signal: { ...base.signal, stopPrice: 8 } });
  assert.equal(normal.riskDollars, 5);
  assert.ok(wide.maxNotional < normal.maxNotional);
  assert.equal(wide.stopPercent, 20);
});
test('open positions and pending orders reserve daily loss capacity', () => {
  const capped = calculateLossBudgetSizing({ ...base, pendingNotional: 300 });
  assert.ok(capped.maxNotional < calculateLossBudgetSizing(base).maxNotional);
  assert.equal(calculateLossBudgetSizing({ ...base, pendingNotional: 400 }).maxNotional, 0);
  assert.equal(calculateLossBudgetSizing({ ...base, positions: [{ symbol: 'OTHER', market_value: 400 }] }).maxNotional, 0);
});
test('scale-ins consume the same symbol risk budget, not a new full budget', () => {
  assert.equal(calculateLossBudgetSizing({ ...base, positions: [{ symbol: 'TEST', market_value: 80 }] }).maxNotional, 0);
});
test('daily losses reduce room and invalid stop/account evidence blocks sizing', () => {
  assert.equal(calculateLossBudgetSizing({ ...base, account: { ...base.account, equity: 980 } }).maxNotional, 0);
  for (const stopPrice of [0, 10, 11, NaN]) assert.equal(calculateLossBudgetSizing({ ...base, signal: { ...base.signal, stopPrice } }).approved, false);
  assert.equal(calculateLossBudgetSizing({ ...base, account: { equity: 'bad' } }).approved, false);
});
test('suggested sizes never round up through risk limits', () => {
  assert.equal(calculateDynamicTradeAmount({ ...base, signalScore: 95, pendingNotional: 315, getExposure: () => 315 }), 0);
  const amount = calculateDynamicTradeAmount({ ...base, signalScore: 95, getExposure: () => 0 });
  assert.ok(amount <= calculateLossBudgetSizing(base).maxNotional);
});
test('final guard rejects oversized risk while leaving protective sells available', () => {
  const context = { ...base, lossBudgetSizing: calculateLossBudgetSizing(base), price: 10 };
  const result = evaluatePreTradeRisk({ order: { symbol: 'TEST', side: 'buy', notional: 100 }, context });
  assert.ok(result.reasons.some(reason => reason.includes('Stop-distance')));
  assert.equal(evaluatePreTradeRisk({ order: { symbol: 'TEST', side: 'sell', qty: 1 }, context }).approved, true);
});
test('ownership follows partial and canceled fills, never requested quantities', () => {
  const orders = [
    { id: 'a', symbol: 'PART', side: 'buy', status: 'partially_filled', filled_qty: '0.2', qty: 10 },
    { id: 'b', symbol: 'CANCEL', side: 'buy', status: 'canceled', filled_qty: '0.1', qty: 2 },
    { id: 'c', symbol: 'WAIT', side: 'buy', status: 'accepted', qty: 5 },
  ];
  assert.deepEqual([...confirmedBotOwnedSymbols({ orders, positions: ['PART', 'CANCEL', 'WAIT'].map(symbol => ({ symbol, qty: 1 })),
    isBotOrder: () => true, normalizeSymbol: s => s })], ['PART', 'CANCEL']);
});
test('notional sell dollars are never displayed as remaining shares', () => {
  const [exit] = buildPendingExits({ openOrders: [{ symbol: 'BTC/USD', side: 'sell', status: 'new', notional: '50' }], normalizeSymbol: s => s });
  assert.equal(exit.qty, 0); assert.equal(exit.notional, 50);
});
test('peak-only performance can never promote learning', () => {
  const rows = Array.from({ length: 100 }, (_, i) => ({ id: i, observedAt: i + 1, symbol: `S${i}`,
    measurements: { 3: { peakReturnPercent: 100 } }, componentScores: { structure: i } }));
  assert.equal(validateQuietLearning(rows, 3).active, false);
});
test('chronological embargo excludes outcomes not yet known when holdout was discovered', () => {
  const rows = Array.from({ length: 100 }, (_, i) => ({ id: i, observedAt: i + 1, symbol: `S${i}`,
    executionCostModelVersion: 1, estimatedRoundTripCostPercent: 0.25,
    measurements: { 3: { closeReturnPercent: 10, evidenceTimestamp: 1000 } }, componentScores: { structure: i }, componentWeights: { structure: 1 } }));
  const learning = validateQuietLearning(rows, 3);
  assert.equal(learning.holdoutCount, 0);
  assert.equal(learning.active, false);
  assert.ok(Object.values(learning.componentMultipliers).every(value => value === 1));
});

function learningFixture() {
  return Array.from({ length: 100 }, (_, i) => {
    const day = i < 60 ? Math.floor(i / 10) : 20 + Math.floor((i - 60) / 10);
    const observedAt = Date.UTC(2026, 0, 1 + day);
    const rank = i % 10;
    return { id: String(i).padStart(3, '0'), symbol: `S${rank}`, observedAt,
      observedDay: new Date(observedAt).toISOString().slice(0, 10),
      executionCostModelVersion: 1, estimatedRoundTripCostPercent: 0.25,
      componentScores: { informative: rank * 10, misleading: 100 - rank * 10 },
      componentWeights: { informative: 0.5, misleading: 0.5 },
      measurements: { 3: { closeReturnPercent: rank - 4, evidenceTimestamp: observedAt + 3 * 86400000 } } };
  });
}
test('only a net-positive challenger beating held-out baseline can activate bounded weights', () => {
  const result = validateQuietLearning(learningFixture(), 3);
  assert.equal(result.active, true);
  assert.equal(result.trainingCount, 60);
  assert.equal(result.holdoutCount, 40);
  assert.ok(result.challengerNetReturnPercent > result.baselineNetReturnPercent);
  assert.ok(Object.values(result.componentMultipliers).every(n => n >= 0.9 && n <= 1.1));
});
test('training cutoff stays fixed when future samples arrive; peaks cannot rescue losses', () => {
  const rows = learningFixture();
  const initial = validateQuietLearning(rows, 3);
  const future = rows.slice(-10).map(o => ({ ...o, id: `future:${o.id}`, observedAt: o.observedAt + 100 * 86400000 }));
  const next = validateQuietLearning([...rows, ...future], 3, 30, initial.trainingCutoffAt);
  assert.equal(next.trainingCount, 60);
  assert.equal(next.trainingCutoffAt, initial.trainingCutoffAt);
  const losers = rows.map(o => ({ ...o, measurements: { 3: { ...o.measurements[3], closeReturnPercent: -5, peakReturnPercent: 100 } } }));
  assert.equal(validateQuietLearning(losers, 3).active, false);
});
