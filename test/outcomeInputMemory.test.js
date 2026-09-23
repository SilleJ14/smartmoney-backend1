import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { outcomeInput } from '../scoring/outcomeInput.js';
import { updateQuietCandidateOutcomes } from '../scoring/quietCandidateOutcomeTracker.js';
import { createDiscoveryOutcomeStore } from '../scoring/discoveryOutcomeStore.js';

const now = Date.parse('2026-09-23T14:00:00Z');
const candidate = () => ({ symbol: 'BTC/USD', assetClass: 'crypto', price: 100,
  liveQuoteUpdatedAt: new Date(now).toISOString(), percentChange: 2,
  cryptoDiscoveryScorecard: { score: 70, components: [{ name: 'volume', value: 80, weight: 0.2, available: true }] },
  newsCatalyst: { dataAvailable: true, catalystScore: 60 },
  chartBars: Array.from({ length: 2000 }, (_, i) => ({ c: i + 1 })),
  centralAutonomousDecisionCore: { unusedPayload: 'x'.repeat(200000) } });

test('queued outcome projection preserves observations without retaining full candidate graphs', () => {
  const row = candidate(), input = outcomeInput(row);
  assert.ok(JSON.stringify(input).length < 1000);
  assert.equal(input.chartBars, undefined);
  assert.equal(input.centralAutonomousDecisionCore, undefined);
  const options = { assetClass: 'crypto', dayKey: '2026-09-23', now };
  assert.deepEqual(updateQuietCandidateOutcomes({}, [input], [input], options),
    updateQuietCandidateOutcomes({}, [row], [row], options));
  row.newsCatalyst.catalystScore = 1;
  row.cryptoDiscoveryScorecard.components[0].value = 0;
  assert.equal(input.newsCatalyst.catalystScore, 60);
  assert.equal(input.cryptoDiscoveryScorecard.components[0].value, 80);
});

test('outcome queue rejects over-budget payloads explicitly and releases its budget', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sm-outcome-budget-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const store = createDiscoveryOutcomeStore(dir, { maxPendingBytes: 5000 });
  const options = { assetClass: 'crypto', dayKey: '2026-09-23', now };
  const row = candidate();
  await assert.rejects(store.ingest([{ ...row, newsCatalyst: { headline: 'x'.repeat(6000) } }], [], options),
    { code: 'OUTCOME_STORAGE_BACKPRESSURE' });
  assert.equal(store.getStatus().pendingBytes, 0);
  await store.ingest([row], [row], options);
  assert.equal(store.getStatus().pendingBytes, 0);
  assert.ok(store.getStatus().peakPendingBytes < 5000);
  assert.equal(store.getStatus().rejected, 1);
});

test('repeated projection retains a bounded research payload over 5000 scan generations', () => {
  const queue = [];
  for (let i = 0; i < 5000; i++) {
    queue.push(outcomeInput({ ...candidate(), generation: i }));
    if (queue.length > 64) queue.shift();
  }
  assert.ok(JSON.stringify(queue).length < 64000);
});
