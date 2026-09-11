import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createEarlyCandidateReassessment } from '../discovery/earlyCandidateReassessment.js';
test('early research is bounded, fair, single-flight, retry-limited and traced', async () => {
  let now = Date.now(), allowed = false; const seen = [], events = [];
  const worker = createEarlyCandidateReassessment({ capacity: 4, batchSize: 2, now: () => now,
    canRun: () => allowed, analyze: async symbols => { seen.push(symbols); return symbols.map(symbol => ({ symbol })); },
    publish: () => {}, trace: event => events.push(event),
  });
  const symbols = ['A', 'B', 'C', 'D', 'E', 'BTC/USD'];
  assert.equal((await worker.run(symbols)).skipped, true); allowed = true;
  await Promise.all([worker.run(symbols), worker.run(symbols)]);
  assert.deepEqual(seen, [['A', 'B']]); await worker.run(symbols);
  assert.deepEqual(seen[1], ['C', 'D']);
  assert.ok(events.some(e => e.stage === 'EARLY_ANALYSIS_COMPLETED'));
  now += 120001; await worker.run(['A']); assert.ok(seen.at(-1).includes('A'));
});
test('early research contains failures instead of crashing the scheduler', async () => {
  const worker = createEarlyCandidateReassessment({ analyze: async () => { throw new Error('provider failure'); }, publish: () => {} });
  assert.equal((await worker.run(['AAPL'])).failed, true);
});

test('crypto research admits USD pairs, stays bounded and independent of stock market hours', async () => {
  let clock = 100000; const batches = [];
  const worker = createEarlyCandidateReassessment({ capacity: 3, batchSize: 2, retryMs: 60000, now: () => clock,
    acceptsSymbol: symbol => /^[A-Z0-9]{1,15}\/USD$/.test(symbol),
    analyze: async symbols => { batches.push(symbols); return symbols.map(symbol => ({ symbol })); }, publish: () => {} });
  await worker.run(['BTC/USD', 'AAPL', 'ETH/USD', 'SOL/USD']);
  assert.deepEqual(batches[0], ['BTC/USD', 'ETH/USD']);
  await worker.run(['BTC/USD', 'ETH/USD']);
  assert.deepEqual(batches[1], ['SOL/USD']);
  assert.equal((await worker.run(['BTC/USD'])).skipped, true);
  clock += 60000;
  await worker.run(['BTC/USD']); assert.deepEqual(batches[2], ['BTC/USD']);
});
test('analysis-only branch returns before pyramid and capital allocation stages', () => {
  const source = fs.readFileSync(new URL('../strategies/stockMarketStrategy.js', import.meta.url), 'utf8');
  const branch = source.indexOf('if (analysisOnly) {');
  const pyramid = source.indexOf('const pyramidAdds = await executePyramidScalingAdds');
  assert.ok(branch > 0 && branch < pyramid);
  const code = source.slice(branch, pyramid);
  assert.match(code, /return normalizeSignalScoreCollection/);
  assert.match(code, /qualifiedToBuy: false/);
  assert.match(code, /finalApprovedTradeAmount: 0/);
});
