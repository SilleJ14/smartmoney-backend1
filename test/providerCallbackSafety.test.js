import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { parse } from 'acorn';
import { createSingleFlight } from '../utils/singleFlight.js';

const source = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
const tree = parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
function openHandler(name) {
  const declaration = tree.body.find(node => node.type === 'FunctionDeclaration' && node.id.name === name);
  let handler;
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'AssignmentExpression' && node.left?.property?.name === 'onopen') handler = node.right;
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object') visit(value);
    }
  }
  visit(declaration);
  assert.ok(handler, `real ${name} onopen handler not found`);
  return source.slice(handler.start, handler.end);
}

for (const provider of ['Polygon', 'Finnhub']) test(`${provider} real onopen handler contains subscription-send exceptions and reconnects`, () => {
  let closed = 0, reconnects = 0;
  const records = [];
  const socket = { send() { throw new Error('fixture socket unavailable'); }, close() { closed++; } };
  const context = {
    engineState: {}, polygonLiveSocket: socket, finnhubLiveSocket: socket,
    polygonAuthenticated: true, polygonSubscribedSymbols: new Set(),
    finnhubSocketReconnectAttempts: 0, finnhubSubscribedSymbols: new Set(), finnhubProviderToAppSymbol: new Map(),
    POLYGON_API_KEY: 'fixture-not-a-credential', FINNHUB_CRYPTO_EXCHANGE: 'fixture', FINNHUB_CRYPTO_QUOTE: 'USD',
    refreshFinnhubLiveSubscriptions: () => socket.send(),
    schedulePolygonReconnect: () => reconnects++, scheduleFinnhubReconnect: () => reconnects++,
    processDiagnostics: { record: (event) => records.push(event) },
  };
  const name = provider === 'Polygon' ? 'startPolygonStockStream' : 'startFinnhubStream';
  assert.doesNotThrow(() => vm.runInNewContext(`(${openHandler(name)})()`, context, { timeout: 1000 }));
  assert.equal(closed, 1);
  assert.equal(reconnects, 1);
  assert.equal(records[0], `${provider.toUpperCase()}_STREAM_OPEN_FAILED`);
  const state = provider === 'Polygon' ? context.engineState.polygonLiveStreamState : context.engineState.liveQuoteStreamState;
  assert.equal(state.ok, false);
  assert.match(state.error, /initialization failed/);
});

test('real runner entry point coalesces direct API, engine and feed callers', async () => {
  const declaration = tree.body.find(node => node.type === 'FunctionDeclaration' && node.id.name === 'runFastRunnerEngine');
  let runs = 0, release;
  const context = {
    fastRunnerSingleFlight: createSingleFlight(),
    runFastRunnerEnginePass: () => { runs++; return new Promise(resolve => { release = resolve; }); },
  };
  const runner = vm.runInNewContext(`(${source.slice(declaration.start, declaration.end)})`, context);
  const requests = Array.from({ length: 200 }, () => runner());
  await Promise.resolve();
  assert.equal(runs, 1);
  release({ reviewedCount: 200 });
  assert.ok((await Promise.all(requests)).every(result => result.reviewedCount === 200));
});
