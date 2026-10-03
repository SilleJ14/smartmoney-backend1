import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
const start = source.indexOf('async function flattenStocksBeforeMarketClose(');
const stop = source.indexOf('\nasync function forceCloseAllPositions', start);
const actualFlatten = source.slice(start, stop);

function harness({ autoTradingEnabled = true, intents = {}, owned = ['BOTDAY', 'BOTSWING'], ownership } = {}) {
  const sells = [], cancels = [], failures = [];
  const engineState = {
    aiManagedSymbols: [],
    liveTradeLimitState: { positionIntents: intents },
  };
  const deps = {
    engineState,
    autoTradingEnabled,
    minutesUntil: () => 30,
    normalizeSymbol: s => String(s || '').toUpperCase(),
    isCrypto: s => String(s).includes('/'),
    isBotOrder: o => String(o.client_order_id || '').startsWith('SM_AI'),
    getStoredStockHoldCategory: s => intents[s]?.holdCategory || 'intraday',
    getBotOwnedSymbols: ownership || (async () => new Set(owned)),
    getOrders: async () => [
      { id: 'owner-buy', symbol: 'MINE', side: 'buy', status: 'new', client_order_id: 'web-123' },
      { id: 'bot-buy', symbol: 'NEWBUY', side: 'buy', status: 'new', client_order_id: 'SM_AI_STOCK_BUY' },
      { id: 'bot-swing-sell', symbol: 'BOTSWING', side: 'sell', status: 'new', client_order_id: 'SM_AI_SELL_X' },
      { id: 'protect', symbol: 'BOTDAY', side: 'sell', status: 'new', client_order_id: 'SM_PROTECT_abc' },
    ],
    getPositions: async () => [
      { symbol: 'BOTDAY', qty: '5' }, { symbol: 'BOTSWING', qty: '3' },
      { symbol: 'MINE', qty: '10' }, { symbol: 'BTC/USD', qty: '1' },
    ],
    alpacaTradingRequest: async path => cancels.push(path.split('/').pop()),
    placeMarketSell: async (symbol, qty) => { sells.push([symbol, qty]); return {}; },
    recordOrder: () => {},
    recordFailedOrder: (...args) => failures.push(args),
  };
  const flatten = new Function(...Object.keys(deps), `${actualFlatten}; return flattenStocksBeforeMarketClose;`)(
    ...Object.values(deps));
  return { flatten, engineState, sells, cancels, failures };
}

const clock = { is_open: true, next_close: '2026-10-02T20:00:00Z' };

test('pre-close flatten sells only bot-owned intraday stock and cancels only bot orders', async () => {
  const { flatten, sells, cancels } = harness({ intents: { BOTSWING: { holdCategory: 'multi_day' } } });
  assert.equal(await flatten(clock), true);
  assert.deepEqual(sells, [['BOTDAY', 5]], 'multi-day, owner and crypto positions are kept');
  assert.deepEqual(cancels, ['bot-buy'], 'owner orders, protective stops and multi-day exits are kept');
});

test('pre-close flatten with Autopilot OFF stops new entries without selling or cancelling', async () => {
  const { flatten, engineState, sells, cancels } = harness({ autoTradingEnabled: false });
  assert.equal(await flatten(clock), true);
  assert.equal(engineState.stockTradingStoppedForDay, true);
  assert.deepEqual(sells, []);
  assert.deepEqual(cancels, []);
});

test('pre-close flatten retries later when bot ownership cannot be confirmed', async () => {
  const { flatten, engineState, sells, failures } = harness({ ownership: async () => { throw new Error('orders unavailable'); } });
  assert.equal(await flatten(clock), true);
  assert.deepEqual(sells, [], 'never sell without confirmed ownership');
  assert.equal(failures.length, 1);
  assert.equal(engineState.lastFlattenAllBeforeCloseAt, null, 'the next cycle retries');
});
