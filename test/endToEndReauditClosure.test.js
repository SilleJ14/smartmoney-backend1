import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createDiscoveryOutcomeStore } from '../scoring/discoveryOutcomeStore.js';
import { updateQuietCandidateOutcomes, normalizeOutcomeObservation,
  summarizeQuietCandidateOutcomes, calculateQuietCandidateLearning, getQuietFollowupSymbols } from '../scoring/quietCandidateOutcomeTracker.js';
import { readSafetyJournal } from '../state/safetyJournal.js';
import { outstandingOrderNotional } from '../risk/orderRiskReservations.js';
import { parsePolygonSnapshotTickers } from '../providers/polygonProvider.js';
import { registerLiveMoversRoutes } from '../routes/liveMoversRoutes.js';
import { buildCryptoDecisionScore } from '../scoring/componentScore.js';
import { installCentralDecision } from '../scoring/installCentralDecision.js';

const DAY = 86400000, start = Date.parse('2026-09-08T18:00:00Z');
const iso = t => new Date(t).toISOString(), day = t => iso(t).slice(0, 10);
const quote = (t, price = 100, symbol = 'ETH/USD') => ({ symbol, price, liveQuoteUpdatedAt: iso(t) });
const options = t => ({ assetClass: 'crypto', dayKey: day(t), now: t });
async function temporary(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'sm-reaudit-closure-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

test('durable same-day updates preserve observed peaks and trades across restart without changing baseline', async t => {
  const dir = await temporary(t);
  let store = createDiscoveryOutcomeStore(dir);
  await store.ingest([quote(start)], [quote(start)], options(start));
  await store.ingest([quote(start + 1000, 150)], [quote(start + 1000, 150)], options(start + 1000));
  store = createDiscoveryOutcomeStore(dir);
  await store.ingest([quote(start + 2000, 110)], [quote(start + 2000, 110)], {
    ...options(start + 2000), tradedSymbols: ['ETH/USD'],
  });
  const page = await store.readPage('crypto', day(start), 'ETH/USD');
  assert.equal(page.observations.length, 1);
  const row = page.observations[0];
  assert.equal(row.baselinePrice, 100);
  assert.equal(row.observedAt, start);
  assert.equal(row.trackingPeakPrice, 150);
  assert.equal(row.becameTrade, true);
  assert.equal(row.alreadyTradedAtSelection, false);
  await store.process(async (_, symbols) => symbols.map(s => quote(start + DAY, 100, s)), { now: start + DAY });
  assert.equal((await store.readPage('crypto', day(start), 'ETH/USD')).observations[0].measurements[1].peakReturnPercent, 50);
});

test('price-only ingestion updates an earlier active cohort, not only today registration', async t => {
  const store = createDiscoveryOutcomeStore(await temporary(t));
  await store.ingest([quote(start)], [quote(start)], options(start));
  const next = start + DAY;
  await store.ingest([], [quote(next, 125)], options(next));
  const row = (await store.readPage('crypto', day(start), 'ETH/USD')).observations[0];
  assert.equal(row.trackingPeakPrice, 125);
  assert.equal(row.measurements[1].closeReturnPercent, 25);
  assert.equal(row.baselinePrice, 100);
});

test('confirmed fill events update persisted observations even without a held position or due horizon', async t => {
  const dir = await temporary(t), store = createDiscoveryOutcomeStore(dir);
  await store.ingest([quote(start)], [quote(start)], options(start));
  let result = await store.process(async () => assert.fail('no horizon is due'), {
    now: start + 1000, tradeEvents: [{ symbol: 'ETHUSD', filledAt: start - 1 }],
  });
  assert.equal(result.recentMeasurements[0].becameTrade, false);
  result = await store.process(async () => assert.fail('no horizon is due'), {
    now: start + 2000, tradeEvents: [{ symbol: 'ETHUSD', filledAt: start + 500 },
      { symbol: 'ETHUSD', filledAt: start + 3000 }],
  });
  assert.equal(result.recentMeasurements[0].becameTradeAt, start + 500);
  const restored = createDiscoveryOutcomeStore(dir);
  assert.equal((await restored.readPage('crypto', day(start), 'ETH/USD')).observations[0].becameTrade, true);
});

test('absent selection benchmarks stay explicitly unavailable and are never backfilled with later prices', async t => {
  const store = createDiscoveryOutcomeStore(await temporary(t));
  await store.ingest([quote(start)], [quote(start)], options(start));
  for (const d of [1, 3, 5]) {
    const at = start + d * DAY;
    await store.process(async () => [quote(at), quote(at, 1000, 'BTC/USD')], { now: at });
  }
  const page = await store.readPage('crypto', day(start), 'ETH/USD'), row = page.observations[0];
  assert.equal(row.benchmarks.Bitcoin.baselinePrice, null);
  assert.equal(row.benchmarks.Bitcoin.baselineStatus, 'MISSING_BASELINE_EVIDENCE');
  assert.equal(row.benchmarkMeasurements[5].Bitcoin, null);
  assert.equal(page.completionStatus, 'COMPLETE_WITH_UNAVAILABLE_EVIDENCE');
  assert.deepEqual(getQuietFollowupSymbols({ observations: [row] }, { now: start + 5 * DAY }), []);
});

test('available benchmarks retain selection prices and produce verified 1/3/5 day comparisons', async t => {
  const store = createDiscoveryOutcomeStore(await temporary(t));
  const btc = { ...quote(start, 200, 'BTC/USD'), percentChange: 3 };
  await store.ingest([quote(start)], [quote(start), btc], options(start));
  for (const d of [1, 3, 5]) {
    const at = start + d * DAY;
    await store.process(async (_, symbols) => symbols.map(s => quote(at, s === 'BTC/USD' ? 220 : 105, s)), { now: at });
  }
  const page = await store.readPage('crypto', day(start), 'ETH/USD'), row = page.observations[0];
  assert.equal(page.completionStatus, 'COMPLETE');
  for (const d of [1, 3, 5]) {
    assert.equal(row.benchmarkMeasurements[d].Bitcoin, 10);
    assert.equal(row.benchmarkMeasurements[d].simpleMomentum, 10);
  }
});

test('baseline-only failures retire from active rotation and survive restart in archive', async t => {
  const dir = await temporary(t), store = createDiscoveryOutcomeStore(dir);
  await store.ingest([{ symbol: 'ETH/USD' }], [], options(start));
  assert.equal((await store.process(async () => [], { now: start + 9 * DAY })).activePages, 1);
  assert.equal((await store.process(async () => [], { now: start + 11 * DAY })).activePages, 0);
  const restored = createDiscoveryOutcomeStore(dir);
  assert.equal((await restored.process(async () => [], { now: start + 12 * DAY })).pagesProcessed, 0);
  const page = await restored.readPage('crypto', day(start), 'ETH/USD');
  assert.equal(page.missingBaselines[0].status, 'UNMEASURABLE_BASELINE');
  assert.equal(page.completionStatus, 'COMPLETE_WITH_UNAVAILABLE_EVIDENCE');
});

test('bounded active-page index fails visibly at capacity without discarding registered evidence', async t => {
  const store = createDiscoveryOutcomeStore(await temporary(t), { maxActivePages: 1 });
  await store.ingest([quote(start)], [quote(start)], options(start));
  await assert.rejects(store.ingest([quote(start + DAY)], [quote(start + DAY)], options(start + DAY)), /capacity/);
  assert.equal((await store.readPage('crypto', day(start), 'ETH/USD')).observations.length, 1);
});

test('unmeasured horizons cannot be archived as fully complete even with selection benchmarks', async t => {
  const store = createDiscoveryOutcomeStore(await temporary(t));
  const q = { ...quote(start, 100, 'BTC/USD'), percentChange: 2 };
  await store.ingest([q], [q], options(start));
  await store.process(async () => [], { now: start + 8 * DAY });
  assert.equal((await store.readPage('crypto', day(start), 'BTC/USD')).completionStatus, 'COMPLETE_WITH_UNAVAILABLE_EVIDENCE');
});

test('stock selection-day session high never becomes a post-selection breakout', () => {
  const bar = { symbol: 'TEST', d: day(start), c: 100, h: 160 };
  let state = updateQuietCandidateOutcomes({}, [bar], [bar], { ...options(start), assetClass: 'stock' });
  state = updateQuietCandidateOutcomes(state, [], [{ ...bar, c: 101 }], { ...options(start + 1000), assetClass: 'stock' });
  assert.equal(state.observations[0].trackingPeakPrice, 101);
  const closeTime = Date.parse('2026-09-09T21:00:00Z');
  state = updateQuietCandidateOutcomes(state, [], [{ symbol: 'TEST', d: day(closeTime), c: 100, h: 102 }], { ...options(closeTime), assetClass: 'stock' });
  assert.equal(state.observations[0].measurements[1].peakReturnPercent, 2);
  assert.equal(state.observations[0].measurements[1].breakoutHit, false);
});

test('stock premarket and intraday prices cannot freeze a target close, and live price cannot replace bar close', () => {
  const bar = { symbol: 'TEST', d: day(start), c: 100 };
  let state = updateQuietCandidateOutcomes({}, [bar], [bar], { ...options(start), assetClass: 'stock' });
  for (const time of ['2026-09-09T12:00:00Z', '2026-09-09T19:59:00Z']) {
    const at = Date.parse(time);
    state = updateQuietCandidateOutcomes(state, [], [{ symbol: 'TEST', t: time, d: day(at), current: 110, c: 110 }], { ...options(at), assetClass: 'stock' });
    assert.equal(state.observations[0].measurements[1], undefined);
  }
  const at = Date.parse('2026-09-09T21:00:00Z');
  state = updateQuietCandidateOutcomes(state, [], [{ symbol: 'TEST', d: day(at), c: 90, current: 111 }], { ...options(at), assetClass: 'stock' });
  assert.equal(state.observations[0].measurements[1].closeReturnPercent, -10);
  assert.equal(state.observations[0].measurements[1].priceBasis, 'COMPLETED_SESSION_CLOSE');
});

test('legacy measured outcomes are preserved but excluded from current learning and proof summaries', () => {
  const row = { symbol: 'ETH/USD', assetClass: 'crypto', evidenceVersion: 2, baselinePrice: 100,
    trackingPeakPrice: 999, targetTimestamps: { 3: start },
    measurements: { 3: { evidenceVerified: true, peakReturnPercent: 899, closeReturnPercent: 10 } } };
  const state = { updatedAt: iso(start + DAY), observations: [row] };
  assert.equal(calculateQuietCandidateLearning(state, { assetClass: 'crypto', minSamples: 1, minUniqueSymbols: 1 }).sampleCount, 0);
  assert.equal(summarizeQuietCandidateOutcomes(state).crypto.measuredObservationCount, 0);
  const migrated = normalizeOutcomeObservation(row);
  assert.equal(migrated.measurements[3], undefined);
  assert.equal(migrated.legacyMeasurements[3].peakReturnPercent, 899);
  assert.equal(migrated.legacyMeasurements[3].evidenceVerified, false);
  assert.equal(migrated.trackingPeakPrice, 100);
  assert.equal(row.trackingPeakPrice, 999, 'migration must not mutate its input');
  assert.equal(normalizeOutcomeObservation({ ...migrated, trackingPeakPrice: 120 }).trackingPeakPrice, 120);
});

for (const flag of ['released', 'reflectedInPositions', 'countedIntraday', 'imported']) {
  test(`journal rejects malformed ${flag} rather than releasing exposure`, async t => {
    const dir = await temporary(t), file = path.join(dir, 'safety.json');
    const entry = { id: 'pending', symbol: 'ETHUSD', category: 'crypto', notional: 1000,
      createdAt: Date.now(), filledQty: 0, status: 'new' };
    for (const value of ['false', 'true', 0, 1, null, {}]) {
      await fs.writeFile(file, JSON.stringify({ version: 1, state: { orderRiskReservations: { pending: { ...entry, [flag]: value } } } }));
      assert.equal(readSafetyJournal(file).safetyReconciliationRequired, true);
    }
    await fs.writeFile(file, JSON.stringify({ version: 1, state: { orderRiskReservations: { pending: { ...entry, [flag]: false } } } }));
    assert.equal(outstandingOrderNotional(readSafetyJournal(file).orderRiskReservations.pending), 1000);
    assert.equal(outstandingOrderNotional({ ...entry, released: 'false', reflectedInPositions: 'false' }), 1000);
    assert.equal(outstandingOrderNotional({ ...entry, released: true }), 0);
  });
}

test('Polygon uses actual trade timestamp, does not freshen it from snapshot update, and stays discovery-only', () => {
  const parse = lastTrade => parsePolygonSnapshotTickers({ normalizeSymbol: String,
    tickers: [{ ticker: 'TEST', updated: start * 1e6, lastTrade, day: { c: 100 }, prevDay: { c: 90 } }] })[0];
  assert.equal(parse({ p: 100, t: (start - 90000) * 1e6 }).liveQuoteUpdatedAt, iso(start - 90000));
  assert.equal(parse({ p: 100 }).liveQuoteUpdatedAt, null);
  assert.equal(parse(null).liveQuoteUpdatedAt, iso(start));
  assert.equal(parse({ p: 100, t: start * 1e6 }).priceIsLive, false);
});

function approvedCrypto(now) {
  const signal = { symbol: 'BTC/USD', price: 100, current: 100,
    cryptoDiscoveryScorecard: { score: 90, coverage: 1, calculatedAt: iso(now), extension: { alreadyExtended: false } },
    newsCatalyst: { dataAvailable: true, riskDetected: false }, barsFound: 30, windowDollarVolume: 1000000,
    bid: 99.95, ask: 100.05, spreadAvailable: true, priceIsLive: true,
    liveQuoteUpdatedAt: iso(now), spreadUpdatedAt: iso(now), liveQuoteSource: 'alpaca_crypto_latest', spreadSource: 'alpaca_crypto_latest',
    multiDayContinuationScore: 75, multiDayScoreAvailable: true, continuationScorecard: { score: 75, available: true },
    multiDayAccumulation: { seenDays: [2, 1].map(d => day(now - d * DAY)) },
    recommendedTradeAmount: 100, approved: true, backendApproved: true, autoTradeApproved: true, qualifiedToBuy: true };
  const evidence = buildCryptoDecisionScore(signal, { now });
  installCentralDecision(signal, { action: 'ALLOW', cryptoDecisionScore: evidence.score, cryptoDecisionEvidence: evidence }, { crypto: true, now });
  return signal;
}
function route(state) {
  let handler;
  registerLiveMoversRoutes({ get: (_, auth, fn) => { handler = fn; } }, { requireAdmin() {}, getState: () => state,
    normalizeSymbol: String, mergeLiveQuote: s => s, isCrypto: () => true, getRuntimeStatus: () => ({}) });
  return async () => {
    let response;
    await handler({ query: {} }, { json: value => { response = value; }, status() { return this; } });
    assert.equal(response.ok, true);
    return response;
  };
}

test('live cache reuses unchanged responses but invalidates an in-place approval or sizing revocation', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: start });
  for (const mutation of [{ backendApproved: false }, { recommendedTradeAmount: 0, finalApprovedTradeAmount: 0, finalTradeAmount: 0 }]) {
    const signal = approvedCrypto(start), request = route({ lastCryptoSignals: [signal], marketOpen: true });
    assert.equal((await request()).items[0].buyableNow, true);
    assert.equal((await request()).cache.hit, true);
    Object.assign(signal, mutation);
    const after = await request();
    assert.equal(after.cache.hit, false);
    assert.equal(after.items[0].buyableNow, false);
  }
});

test('live cache expires at the actual five-second quote boundary, not the remaining cache TTL', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: start });
  const signal = approvedCrypto(start - 4500), request = route({ lastCryptoSignals: [signal], marketOpen: true });
  assert.equal((await request()).items[0].buyableNow, true);
  t.mock.timers.tick(600);
  const expired = await request();
  assert.equal(expired.cache.hit, false);
  assert.equal(expired.items[0].buyableNow, false);
});
