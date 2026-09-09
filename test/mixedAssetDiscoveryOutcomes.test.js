import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createDiscoveryOutcomeStore } from '../scoring/discoveryOutcomeStore.js';
import { ingestMixedAssetDiscoveryOutcomes } from '../scoring/mixedAssetDiscoveryOutcomes.js';
import { normalizeOutcomeObservation, calculateQuietCandidateLearning,
  summarizeQuietCandidateOutcomes, updateQuietCandidateOutcomes } from '../scoring/quietCandidateOutcomeTracker.js';
import { buildProofReport } from '../analytics/proofReport.js';

const now = Date.parse('2026-09-09T00:30:00Z');
const providerTime = new Date(now - 1000).toISOString();
const candidates = [
  { symbol: 'AAPL', assetClass: 'stock', price: 100, t: providerTime },
  { symbol: 'ETH/USD', assetClass: 'crypto', price: 200, t: providerTime },
];

async function temporaryStore(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'sm-mixed-outcomes-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return createDiscoveryOutcomeStore(directory);
}

test('mixed fast-runner outcomes separate assets, calendars and traded participation', async () => {
  const calls = [];
  const store = { ingest: async (rows, quotes, options) => {
    calls.push({ rows, quotes, options });
    return { registered: rows.length };
  } };
  const result = await ingestMixedAssetDiscoveryOutcomes(store, candidates, candidates,
    { now, tradedSymbols: ['AAPL', 'ETHUSD'] });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map(call => call.options.assetClass), ['stock', 'crypto']);
  assert.deepEqual(calls.map(call => call.options.dayKey), ['2026-09-08', '2026-09-09']);
  assert.deepEqual(calls.map(call => call.options.tradedSymbols), [['AAPL'], ['ETHUSD']]);
  assert.equal(calls[0].rows[0].t, providerTime);
  assert.equal(calls[1].rows[0].liveQuoteUpdatedAt, providerTime);
  assert.deepEqual(result.map(row => row.registered), [1, 1]);
  assert.equal(candidates[1].liveQuoteUpdatedAt, undefined, 'caller evidence is not mutated');
});

test('mixed real durable pages retain every candidate and asset-specific horizon and benchmark', async t => {
  const store = await temporaryStore(t);
  await ingestMixedAssetDiscoveryOutcomes(store, candidates, candidates, { now });
  const stock = (await store.readPage('stock', '2026-09-08', 'AAPL')).observations[0];
  const crypto = (await store.readPage('crypto', '2026-09-09', 'ETH/USD')).observations[0];
  assert.equal(stock.assetClass, 'stock');
  assert.equal(crypto.assetClass, 'crypto');
  assert.equal(stock.baselinePrice, 100);
  assert.equal(crypto.baselinePrice, 200);
  assert.equal(stock.benchmarks.SPY.symbol, 'SPY');
  assert.equal(crypto.benchmarks.Bitcoin.symbol, 'BTC/USD');
  assert.equal(crypto.targetTimestamps[1], now + 86400000);
  assert.equal(stock.targets[1], '2026-09-09');
  assert.equal(stock.alreadyTradedAtSelection, false);
  assert.equal(crypto.alreadyTradedAtSelection, false);
  assert.equal((await store.readPage('stock', '2026-09-08', 'ETH/USD')).observations.length, 0);
  assert.equal((await store.readPage('crypto', '2026-09-09', 'AAPL')).observations.length, 0);
});

test('missing, stale or future crypto provider times cannot become measured baselines', async t => {
  const store = await temporaryStore(t);
  const invalid = [
    { symbol: 'BTC/USD', price: 100, updatedAt: new Date(now).toISOString() },
    { symbol: 'ETH/USD', price: 100, t: new Date(now - 60001).toISOString() },
    { symbol: 'LTC/USD', price: 100, t: new Date(now + 60000).toISOString() },
  ];
  const results = await ingestMixedAssetDiscoveryOutcomes(store, invalid, invalid, { now });
  assert.equal(results[0].registered, 0);
  assert.equal(results[0].missingBaselines, 3);
  for (const candidate of invalid) {
    const page = await store.readPage('crypto', '2026-09-09', candidate.symbol);
    assert.equal(page.observations.length, 0);
    assert.ok(page.missingBaselines.some(row => row.symbol === candidate.symbol));
  }
});

test('cohorts are serialized and durable failure remains visible to scheduler', async () => {
  let finishStock;
  const started = [];
  const store = { ingest: (_rows, _quotes, options) => {
    started.push(options.assetClass);
    return options.assetClass === 'stock'
      ? new Promise(resolve => { finishStock = resolve; })
      : Promise.reject(new Error('Outcome storage queue full; retry required'));
  } };
  const pending = ingestMixedAssetDiscoveryOutcomes(store, candidates, candidates, { now });
  assert.deepEqual(started, ['stock']);
  const rejected = assert.rejects(pending, /Outcome storage queue full/);
  finishStock({ registered: 1 });
  await rejected;
  assert.deepEqual(started, ['stock', 'crypto']);
});

function legacyMisclassifiedOutcome(symbol = 'ETH/USD') {
  return { id: `stock:${symbol}:2026-09-01`, symbol, assetClass: 'stock',
    evidenceVersion: 2, peakPolicyVersion: 3, observedDay: '2026-09-01', observedAt: now - 8 * 86400000,
    baselinePrice: 100, trackingPeakPrice: 120, targets: { 1: '2026-09-02', 3: '2026-09-04', 5: '2026-09-09' },
    measurements: { 3: { evidenceVerified: true, measurementPolicyVersion: 3,
      closeReturnPercent: 15, peakReturnPercent: 20, breakoutHit: true } },
    componentScores: { compression: 80 }, benchmarks: {}, benchmarkMeasurements: {} };
}

test('legacy crypto-in-stock records are quarantined without rewriting identity or measured returns', () => {
  const original = legacyMisclassifiedOutcome();
  const snapshot = structuredClone(original);
  const normalized = normalizeOutcomeObservation(original);
  assert.equal(normalized.evidenceQuarantined, true);
  assert.equal(normalized.evidenceQuarantineReason, 'CRYPTO_IN_STOCK_OUTCOME_COHORT');
  for (const key of Object.keys(original)) assert.deepEqual(normalized[key], original[key], key);
  assert.deepEqual(original, snapshot, 'normalization does not mutate original record');
  const updated = updateQuietCandidateOutcomes({ observations: [original] }, [],
    [{ symbol: original.symbol, d: '2026-09-09', c: 500, h: 600 }],
    { assetClass: 'stock', dayKey: '2026-09-09', now: Date.parse('2026-09-09T21:00:00Z'), fullPopulationPage: true });
  assert.equal(updated.observations.length, 1);
  assert.deepEqual(updated.observations[0].measurements, original.measurements);
  assert.equal(updated.observations[0].trackingPeakPrice, original.trackingPeakPrice);
});

test('raw legacy asset-mismatch rows cannot activate stock learning or inflate proof', () => {
  const observations = Array.from({ length: 30 }, (_, index) => legacyMisclassifiedOutcome(`ASSET${index}/USD`));
  const state = { observations, updatedAt: '2026-09-09T21:00:00Z', updatedDayKey: '2026-09-09' };
  const learning = calculateQuietCandidateLearning(state, { assetClass: 'stock' });
  assert.equal(learning.active, false);
  assert.equal(learning.sampleCount, 0);
  assert.equal(learning.quarantinedObservationCount, 30);
  const summary = summarizeQuietCandidateOutcomes(state);
  assert.equal(summary.stock.observationCount, 30, 'original rows remain visible for audit');
  assert.equal(summary.stock.quarantinedObservationCount, 30);
  assert.equal(summary.stock.measuredObservationCount, 0);
  assert.equal(summary.stock.horizons[3].measuredCount, 0);
  assert.equal(buildProofReport({ outcomeState: state }).assets.stock.horizons[3].all.sampleCount, 0);
  const ordinaryStock = normalizeOutcomeObservation({ ...legacyMisclassifiedOutcome('USD') });
  assert.notEqual(ordinaryStock.evidenceQuarantined, true, 'the actual equity ticker USD is not crypto');
});

test('durable quarantine retains original rows in unavailable archive without wrong-asset followups', async t => {
  const store = await temporaryStore(t);
  const original = legacyMisclassifiedOutcome();
  await store.importObservations([original]);
  const result = await store.process(async () => assert.fail('must not request crypto using stock outcome route'), { now });
  assert.equal(result.errors.length, 0);
  assert.equal(result.activePages, 0);
  const page = await store.readPage('stock', original.observedDay, original.symbol);
  assert.equal(page.completionStatus, 'COMPLETE_WITH_UNAVAILABLE_EVIDENCE');
  assert.equal(page.observations.length, 1);
  assert.equal(page.observations[0].id, original.id);
  assert.equal(page.observations[0].evidenceQuarantined, true);
  assert.deepEqual(page.observations[0].measurements, original.measurements);
  assert.deepEqual(page.observations[0].targets, original.targets);
});
