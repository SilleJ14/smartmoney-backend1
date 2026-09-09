import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parse } from 'acorn';
import { refreshCycleSubscriptions } from '../engine/refreshCycleSubscriptions.js';

const now = () => Date.parse('2026-09-10T00:00:00Z');
const scans = [{ symbol: 'AAPL', discoveryScore: 80 }];

for (const type of ['synchronous', 'asynchronous']) {
  test(`${type} subscription refresh failure is contained and keeps completed scan and safety settings`, async () => {
    const error = new Error('provider url with secret-value');
    const discovery = { ok: true, updatedAt: '2026-09-09T23:59:00Z',
      reason: 'Provider discovery completed.', symbolCount: 27, symbols: ['AAPL'] };
    const engineState = { lastStockSignals: scans, autoTradingEnabled: false, dailyLossLocked: true,
      liveEarlyMoverRefreshState: discovery };
    const warnings = [];
    const result = await refreshCycleSubscriptions({ engineState, now,
      logger: { warn: (...args) => warnings.push(args) },
      refresh: type === 'synchronous' ? () => { throw error; } : async () => { throw error; },
    });
    assert.equal(result.ok, false);
    assert.equal(result.error, 'LIVE_SUBSCRIPTION_REFRESH_FAILED');
    assert.equal(result.errorType, 'Error');
    assert.equal(engineState.liveEarlyMoverRefreshState.cycleSubscriptionRefresh, result);
    const { cycleSubscriptionRefresh, ...preservedDiscovery } = engineState.liveEarlyMoverRefreshState;
    assert.deepEqual(preservedDiscovery, discovery);
    assert.equal(engineState.lastStockSignals, scans);
    assert.equal(engineState.autoTradingEnabled, false);
    assert.equal(engineState.dailyLossLocked, true);
    assert.equal(JSON.stringify([result, warnings]).includes('secret-value'), false);
    assert.equal(warnings.length, 1);
  });
}

test('successful subscription refresh is awaited and clears prior refresh error', async () => {
  let complete;
  let settled = false;
  const engineState = { liveEarlyMoverRefreshState: {
    cycleSubscriptionRefresh: { ok: false, error: 'OLD', errorType: 'Error' },
  } };
  const discovery = { ok: true, updatedAt: '2026-09-09T23:59:59Z',
    reason: 'Polygon movers empty. Using fallback symbols.', symbolCount: 8 };
  const promise = refreshCycleSubscriptions({ engineState, now, refresh: () => new Promise(resolve => {
    complete = () => {
      engineState.liveEarlyMoverRefreshState = discovery;
      resolve({ ok: true });
    };
  }) }).then(result => { settled = true; return result; });
  await Promise.resolve();
  assert.equal(settled, false);
  complete();
  const result = await promise;
  assert.equal(result.ok, true);
  assert.equal(result.error, null);
  assert.equal(result.errorType, null);
  const { cycleSubscriptionRefresh, ...preservedDiscovery } = engineState.liveEarlyMoverRefreshState;
  assert.equal(cycleSubscriptionRefresh, result);
  assert.deepEqual(preservedDiscovery, discovery, 'wrapper retains provider timestamp and detailed reason');
});

test('subscription-only refresh cannot restamp disabled or absent discovery as successful', async () => {
  for (const discovery of [null, { ok: false, updatedAt: '2026-09-01T00:00:00Z',
    symbolCount: 2, symbols: ['AAPL', 'MSFT'], reason: 'Early discovery disabled.' }]) {
    const engineState = { liveEarlyMoverRefreshState: discovery };
    const result = await refreshCycleSubscriptions({ engineState, now,
      refresh: async () => ({ ok: true, earlyMoverCount: 0, polygonState: {}, finnhubSymbols: [] }),
    });
    assert.equal(result.ok, true, 'subscription maintenance may succeed independently');
    const { cycleSubscriptionRefresh, ...preservedDiscovery } = engineState.liveEarlyMoverRefreshState;
    assert.equal(cycleSubscriptionRefresh, result);
    assert.deepEqual(preservedDiscovery, discovery || {});
  }
});

test('retry clears only subscription failure without rewriting discovery evidence', async () => {
  const discovery = { ok: false, updatedAt: '2026-09-01T00:00:00Z', reason: 'Discovery unavailable.' };
  const engineState = { liveEarlyMoverRefreshState: discovery };
  const failed = await refreshCycleSubscriptions({ engineState, now, logger: { warn() {} },
    refresh: async () => { throw new Error('socket closed'); },
  });
  assert.equal(failed.ok, false);
  assert.equal(engineState.liveEarlyMoverRefreshState.cycleSubscriptionRefresh.error, 'LIVE_SUBSCRIPTION_REFRESH_FAILED');
  const retried = await refreshCycleSubscriptions({ engineState, now, refresh: async () => ({ ok: true }) });
  assert.equal(retried.ok, true);
  assert.equal(retried.error, null);
  const { cycleSubscriptionRefresh, ...preservedDiscovery } = engineState.liveEarlyMoverRefreshState;
  assert.equal(cycleSubscriptionRefresh, retried);
  assert.deepEqual(preservedDiscovery, discovery);
});

test('engine cycle production call awaits the protective wrapper instead of detaching refresh', () => {
  const source = fs.readFileSync(new URL('../engine/createEngineCycle.js', import.meta.url), 'utf8');
  const tree = parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
  const calls = [];
  function visit(node, parent) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'CallExpression') calls.push({ node, parent });
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(child => visit(child, node));
      else if (value && typeof value === 'object') visit(value, node);
    }
  }
  visit(tree);
  assert.equal(calls.filter(({ node }) => node.callee.name === 'refreshEarlyMoversThenPolygonSubscriptions').length, 0);
  const guarded = calls.filter(({ node }) => node.callee.name === 'refreshCycleSubscriptions');
  assert.equal(guarded.length, 1);
  assert.equal(guarded[0].parent.type, 'AwaitExpression');
  assert.match(source.slice(guarded[0].node.start, guarded[0].node.end),
    /refresh:\s*refreshEarlyMoversThenPolygonSubscriptions/);
});
