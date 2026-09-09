import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { compactCandidateTrace, createCandidateTraceStore } from '../discovery/candidateTraceStore.js';
import { registerCandidateTraceRoutes } from '../routes/candidateTraceRoutes.js';

async function temp(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'candidate-trace-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

test('trace stores only bounded evidence, never receipt time as provider time or unavailable F', () => {
  const row = compactCandidateTrace({ symbol: 'aapl', stockDecisionScore: 90, stockDecisionScoreAvailable: false,
    masterFinalScore: 90, liveQuoteUpdatedAt: null, secret: 'not-persisted', chartBars: Array(10000).fill(1),
    reasons: Array(100).fill('x'.repeat(1000)) });
  assert.equal(row.providerAt, null);
  assert.equal(row.final, null);
  assert.equal(row.symbol, 'AAPL');
  assert.equal(row.reasons.length, 8);
  assert.ok(JSON.stringify(row).length < 2000);
  assert.ok(!JSON.stringify(row).includes('not-persisted'));
  assert.equal(compactCandidateTrace({ symbol: '../../private' }), null);
  assert.equal(compactCandidateTrace({ symbol: 'BTC/USD', liveQuoteUpdatedAt: Date.now() + 60000 }).providerAt, null);
});

test('trace survives reopen; query caps results, preserves provider timestamp and rejects invalid symbols', async t => {
  const dir = await temp(t), store = createCandidateTraceStore(dir);
  const providerTime = '2026-01-01T15:00:00.000Z';
  store.record({ symbol: 'AAPL', stage: 'EARLY_MOVER_RECEIVED', price: 10, liveQuoteUpdatedAt: providerTime });
  store.record({ symbol: 'AAPL', stage: 'SCAN_SELECTED' });
  await store.flush();
  const reopened = createCandidateTraceStore(dir);
  const result = await reopened.read('AAPL', 9999);
  assert.equal(result.events.length, 2);
  assert.equal(result.limit, 200);
  assert.equal(result.events.find(e => e.stage === 'EARLY_MOVER_RECEIVED').providerAt, providerTime);
  await assert.rejects(() => reopened.read('../private'), /INVALID_SYMBOL/);
});

test('trace backlog and disk are bounded under overload and rotation', async t => {
  const dir = await temp(t), store = createCandidateTraceStore(dir, { fileBytes: 4096 });
  for (let i = 0; i < 1000; i++) store.record({ symbol: 'AAPL', stage: 'SCAN_SELECTED', cycle: String(i), reasons: ['x'.repeat(120)] });
  assert.equal(store.status().pending, 512);
  assert.equal(store.status().dropped, 488);
  await store.flush();
  const files = await fs.readdir(dir);
  assert.equal(files.length, 8);
  let bytes = 0;
  for (const file of files) { const stat = await fs.stat(path.join(dir, file)); assert.ok(stat.size <= 4096); bytes += stat.size; }
  assert.ok(bytes <= store.status().maxDiskBytes);
  assert.ok((await store.read('AAPL', 5)).events.length <= 5);
  assert.equal(store.status().pending, 0);
});

test('trace write failures are reported and do not crash or leave an unbounded retry queue', async t => {
  const dir = await temp(t), blocked = path.join(dir, 'file');
  await fs.writeFile(blocked, 'not a directory');
  const store = createCandidateTraceStore(blocked);
  store.record({ symbol: 'AAPL' });
  await store.flush();
  assert.equal(store.status().pending, 0);
  assert.equal(store.status().dropped, 1);
  assert.ok(store.status().lastError);
});

test('candidate trace route requires admin middleware and does not expose internal errors', async () => {
  const admin = () => {}, calls = [];
  registerCandidateTraceRoutes({ get: (...args) => calls.push(args) }, { requireAdmin: admin,
    store: { read: async () => { throw new Error('secret path'); } } });
  const [route, middleware, handler] = calls[0];
  assert.equal(route, '/discovery/trace'); assert.equal(middleware, admin);
  const res = { status(n) { this.code = n; return this; }, json(body) { this.body = body; return this; } };
  await handler({ query: { symbol: '../private' } }, res); assert.equal(res.code, 400);
  await handler({ query: { symbol: 'aapl' } }, res); assert.equal(res.code, 503);
  assert.ok(!JSON.stringify(res.body).includes('secret'));
});
