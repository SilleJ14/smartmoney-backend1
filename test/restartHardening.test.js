import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { EventEmitter } from 'node:events';
import { spawnSync } from 'node:child_process';
import { readBoundedResponseText, readBoundedResponseJson } from '../utils/boundedResponse.js';
import { createSingleFlight } from '../utils/singleFlight.js';
import { installProcessDiagnostics } from '../bootstrap/processDiagnostics.js';
import { startServerLifecycle } from '../bootstrap/serverLifecycle.js';
import { loadPersistedEngineState } from '../state/loadEngineState.js';
import { updateQuietCandidateOutcomes } from '../scoring/quietCandidateOutcomeTracker.js';

test('advertised oversized body fails even when cancellation never completes', { timeout: 2000 }, async () => {
  let cancelled = false;
  const response = { headers: new Headers({ 'content-length': '999999' }), body: {
    cancel() { cancelled = true; return new Promise(() => {}); },
  } };
  await assert.rejects(readBoundedResponseText(response, { maxBytes: 100, timeoutMs: 30 }), /byte budget/);
  assert.equal(cancelled, true);
});

test('lying content-length and rejected cancellation cannot bypass streaming budget', async () => {
  const response = new Response(new ReadableStream({
    start(c) { c.enqueue(new Uint8Array(300)); },
    cancel() { return Promise.reject(new Error('cancel failed')); },
  }), { headers: { 'content-length': '2' } });
  await assert.rejects(readBoundedResponseText(response, { maxBytes: 100 }), /byte budget/);
});

test('stalled body exits on deadline; late chunks cannot restart its read loop', { timeout: 2000 }, async () => {
  let cancelled = false;
  const response = new Response(new ReadableStream({ cancel() { cancelled = true; return new Promise(() => {}); } }));
  await assert.rejects(readBoundedResponseText(response, { timeoutMs: 25 }), /deadline/);
  assert.equal(cancelled, true);
});

test('Node Readable bodies are bounded and destroyed on failure', async () => {
  const body = Readable.from([Buffer.alloc(100), Buffer.alloc(100)]);
  await assert.rejects(readBoundedResponseText({ body }, { maxBytes: 150 }), /byte budget/);
  assert.equal(body.destroyed, true);
  assert.equal(await readBoundedResponseText({ body: Readable.from(['hello']) }), 'hello');
});

test('malformed JSON is rejected; valid bodies and Unicode survive', async () => {
  await assert.rejects(readBoundedResponseJson(new Response('{bad')), SyntaxError);
  assert.deepEqual(await readBoundedResponseJson(new Response('{"name":"café"}')), { name: 'café' });
  await assert.rejects(readBoundedResponseText(new Response('ok'), { maxBytes: NaN }), /Invalid/);
});

test('concurrent refreshes share success or failure, then permit recovery', async () => {
  const run = createSingleFlight();
  let calls = 0;
  const work = async () => { calls++; await new Promise(r => setTimeout(r, 10)); return ['AAPL']; };
  const values = await Promise.all(Array.from({ length: 50 }, () => run(work)));
  assert.equal(calls, 1);
  assert.equal(values.length, 50);
  const errors = await Promise.allSettled(Array.from({ length: 50 }, () => run(() => { throw new Error('offline'); })));
  assert.ok(errors.every(result => result.status === 'rejected'));
  assert.deepEqual(await run(work), ['AAPL']);
  assert.equal(calls, 2);
});

test('process diagnostics rotate within budget and exclude arbitrary state and secrets', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'smartmoney-diag-test-'));
  const processRef = Object.assign(new EventEmitter(), { pid: 1, env: {}, version: process.version,
    memoryUsage: () => ({ rss: 10 * 1048576, heapUsed: 1048576 }), uptime: () => 3 });
  const diagnostics = installProcessDiagnostics({ directory, processRef, maxFileBytes: 4096, logger: { error() {} } });
  try {
    diagnostics.setSnapshotReader(() => ({ phase: 'STOCK_SCAN', running: true, stocks: 3, secret: 'PRIVATE' }));
    for (let i = 0; i < 100; i++) diagnostics.record('HEARTBEAT');
    diagnostics.record('UNCAUGHT_EXCEPTION', new Error('https://provider/?apiKey=PRIVATE'));
    const files = fs.readdirSync(directory);
    assert.equal(files.length, 2);
    for (const file of files) {
      assert.ok(fs.statSync(path.join(directory, file)).size <= 4096);
      assert.doesNotMatch(fs.readFileSync(path.join(directory, file), 'utf8'), /PRIVATE|apiKey/);
    }
  } finally { diagnostics.dispose(); fs.rmSync(directory, { recursive: true, force: true }); }
});

test('diagnostics observe a real fatal exception without swallowing it', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'smartmoney-fatal-test-'));
  try {
    const moduleUrl = new URL('../bootstrap/processDiagnostics.js', import.meta.url).href;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e',
      `import {installProcessDiagnostics} from ${JSON.stringify(moduleUrl)}; installProcessDiagnostics({directory:${JSON.stringify(directory)}}); setImmediate(()=>{throw new TypeError('fixture failure')});`],
      { encoding: 'utf8', timeout: 5000 });
    assert.equal(result.status, 1, result.stderr);
    assert.match(fs.readFileSync(path.join(directory, 'process.jsonl'), 'utf8'), /UNCAUGHT_EXCEPTION/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

for (const failure of ['throw', 'hang']) test(`shutdown handles ${failure} and exits once with failure`, async () => {
  const events = new EventEmitter(), exits = [];
  events.exit = code => exits.push(code);
  startServerLifecycle({ app: { listen() {} }, port: 0, processRef: events, state: {},
    saveState() { if (failure === 'throw') throw new Error('disk full'); },
    flushState: () => new Promise(() => {}), shutdownTimeoutMs: 20,
    setIntervalFn() {}, logger: { error() {} },
  });
  events.emit('SIGTERM'); events.emit('SIGTERM');
  await new Promise(r => setTimeout(r, 45));
  assert.deepEqual(exits, [1]);
});

test('startup archives oversized state before parsing, even with an unsafe configured limit', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'smartmoney-state-budget-'));
  try {
    for (const [name, size, options] of [
      ['default', 33 * 1048576, {}], ['override', 65 * 1048576, { maxLoadBytes: 1024 * 1048576 }],
      ['invalid', 33 * 1048576, { maxLoadBytes: Infinity }],
    ]) {
      const file = path.join(directory, `${name}.json`);
      const fd = fs.openSync(file, 'w');
      fs.ftruncateSync(fd, size); fs.closeSync(fd);
      const state = loadPersistedEngineState(file, options);
      assert.equal(state.safetyReconciliationRequired, true);
      assert.equal(state.safetyStateLoadFailed, true);
      assert.ok(fs.readdirSync(directory).some(entry => entry.startsWith(`${name}.json.oversized-`)));
    }
    const empty = path.join(directory, 'empty.json');
    fs.writeFileSync(empty, '');
    assert.equal(loadPersistedEngineState(empty).safetyReconciliationRequired, true);
    assert.deepEqual(loadPersistedEngineState(path.join(directory, 'new-install.json')), {});
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('learning ingestion does not construct time-zone formatters per candidate', () => {
  const original = Intl.DateTimeFormat;
  let constructions = 0;
  Intl.DateTimeFormat = function (...args) { constructions++; return new original(...args); };
  try {
    const prices = Array.from({ length: 1000 }, (_, index) => ({ symbol: `S${index}`, c: 100, h: 101, d: '2026-09-09' }));
    const result = updateQuietCandidateOutcomes({}, prices.slice(0, 40), prices, {
      assetClass: 'stock', dayKey: '2026-09-09', now: Date.parse('2026-09-09T21:00:00Z'),
    });
    assert.equal(result.observations.length, 40);
    assert.equal(constructions, 0, 'per-row ICU construction can block health requests under load');
  } finally { Intl.DateTimeFormat = original; }
});
