import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createOutcomeFailureReporter } from '../scoring/outcomeFailureReporter.js';

test('learning gaps survive reporter restart and do not store candidate payloads', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sm-gap-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const logs = [], logger = { error: (...args) => logs.push(args) };
  const failure = { candidates: [{ symbol: 'AAPL', secret: 'PRIVATE', chartBars: [] }],
    options: { assetClass: 'stock', now: 1, dayKey: '2026-09-23' }, error: { code: 'OUTCOME_STORAGE_BACKPRESSURE' } };
  assert.equal(createOutcomeFailureReporter(dir, { logger })(failure).durable, true);
  createOutcomeFailureReporter(dir, { logger })(failure);
  const content = fs.readFileSync(path.join(dir, 'outcome-gaps.jsonl'), 'utf8');
  assert.equal(content.trim().split('\n').length, 2);
  assert.doesNotMatch(content, /PRIVATE|chartBars/);
  assert.equal(logs.length, 2);
});
test('failed gap persistence is explicitly reported to retained service logs', () => {
  const logs = [];
  const report = createOutcomeFailureReporter('unused', {
    io: { mkdirSync() { throw new Error('Disk unavailable'); } },
    logger: { error: (...args) => logs.push(args) },
  });
  const gap = report({ error: new Error('secret provider failure') });
  assert.equal(gap.durable, false);
  assert.equal(gap.retryStatus, 'NOT_REPLAYED');
  assert.match(logs[0][1], /STORAGE_WRITE_FAILED/);
  assert.doesNotMatch(logs[0][1], /secret provider/);
});
