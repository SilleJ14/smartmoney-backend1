import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchWithTimeout } from '../utils/fetchWithTimeout.js';
import { selectCandidateDisplayWindow } from '../scoring/canonicalSignalRank.js';
import { startServerLifecycle } from '../bootstrap/serverLifecycle.js';
import { createAlpacaClient } from '../execution/alpacaClient.js';
import fs from 'node:fs';
import vm from 'node:vm';

test('caller cancellation does not disable the request deadline', async () => {
  const previous = globalThis.fetch;
  let observed;
  globalThis.fetch = (_url, options) => new Promise((_resolve, reject) => {
    observed = options.signal;
    options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  });
  try {
    const caller = new AbortController();
    await assert.rejects(fetchWithTimeout('https://fixture.invalid', { signal: caller.signal }, 20), /aborted/);
    assert.equal(observed.aborted, true);
    assert.equal(caller.signal.aborted, false);
    const other = new AbortController();
    const request = fetchWithTimeout('https://fixture.invalid', { signal: other.signal }, 1000);
    other.abort();
    await assert.rejects(request, /aborted/);
    globalThis.fetch = async (_url, options) => { observed = options.signal; return {}; };
    const bodyCaller = new AbortController();
    await fetchWithTimeout('https://fixture.invalid', { signal: bodyCaller.signal }, 1000);
    bodyCaller.abort();
    assert.equal(observed.aborted, true, 'caller must still be able to abort the body after headers');
  } finally { globalThis.fetch = previous; }
});

test('display limit reserves stock visibility without changing any score or approval', () => {
  const stock = { symbol: 'AAPL', stockDecisionScoreAvailable: false, approved: false };
  const crypto = Array.from({ length: 60 }, (_, i) => ({ symbol: `C${i}/USD`, cryptoDecisionScore: 80,
    cryptoDecisionScoreAvailable: true, approved: false }));
  const result = selectCandidateDisplayWindow([...crypto, stock], 50);
  assert.equal(result.length, 50);
  assert.ok(result.includes(stock));
  assert.equal(stock.stockDecisionScoreAvailable, false);
  assert.ok(result.every(s => s.approved === false));
  assert.equal(selectCandidateDisplayWindow(crypto, NaN).length, 50);
});

test('failed provider startup does not skip other services or reject listen callback', async () => {
  let started = 0, callback;
  const state = {};
  startServerLifecycle({ app: { listen(_port, _host, cb) { callback = cb; } }, port: 0,
    processRef: { on() {} }, state, startServices: [
      function syncFailure() { throw new Error('sync feed failure'); },
      async function asyncFailure() { throw new Error('async feed failure'); },
      () => { started++; },
    ], saveState() {}, saveRenderMemory() {}, checkRunnerResults: async () => {},
    setIntervalFn() {}, logger: { log() {}, error() {} }, runStartupEngineScan: false });
  await callback();
  assert.equal(started, 1);
  assert.equal(Object.keys(state.serviceStartupErrors).length, 2);
});

test('broker response body is bounded instead of hanging the scan forever', async () => {
  const client = createAlpacaClient({ getKeys: () => ({ key: 'fixture', secret: 'fixture' }),
    getTradingBaseUrl: () => 'https://fixture.invalid',
    fetchWithTimeout: async () => ({ ok: true, text: () => new Promise(() => {}) }) });
  await assert.rejects(client.tradingRequest('/v2/clock', { timeoutMs: 20 }), /deadline/);
});

test('Polygon auth failure is not mistaken for success and close retains diagnostics', async () => {
  const source = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  const block = source.slice(source.indexOf('function startPolygonStockStream()'), source.indexOf('function clampLiveScore'));
  let socket, subscriptions = 0, reconnects = 0;
  class FakeSocket { constructor() { socket = this; } close() { this.onclose?.({ code: 1008, reason: 'Access denied' }); } }
  const state = {};
  const context = vm.createContext({ ENABLE_POLYGON: true, ENABLE_POLYGON_WEBSOCKET: true, POLYGON_API_KEY: 'fixture',
    POLYGON_WS_URL: 'fixture:', WebSocketImpl: FakeSocket, engineState: state, polygonLiveSocket: null,
    polygonAuthenticated: false, polygonSubscribedSymbols: new Set(), polygonSocketReconnectAttempts: 0,
    refreshEarlyMoversThenPolygonSubscriptions: async () => { subscriptions++; return {}; },
    handlePolygonLiveMessage() {}, schedulePolygonReconnect() { reconnects++; }, console: { warn() {}, error() {} } });
  vm.runInContext(block + '\nstartPolygonStockStream();', context);
  await socket.onmessage({ data: JSON.stringify([{ ev: 'status', status: 'auth_failed', message: 'Not authenticated' }]) });
  assert.equal(subscriptions, 0);
  assert.equal(reconnects, 0);
  assert.equal(state.polygonEntitlementBlocked, true);
  assert.equal(state.polygonLiveStreamState.error, 'Not authenticated');
  assert.equal(state.polygonLiveStreamState.ok, false);
});
