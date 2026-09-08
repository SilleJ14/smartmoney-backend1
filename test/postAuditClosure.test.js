import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createOrderService } from '../execution/orderService.js';
import { createOrderRiskReservations } from '../risk/orderRiskReservations.js';
import { validBrokerAccount, validBrokerPositions, availableBuyingPower } from '../risk/brokerEvidence.js';
import { createAssetQuotePump } from '../market-data/assetQuotePump.js';
import { normalizeCandidateQuote } from '../market-data/normalizeCandidateQuote.js';
import { createDiscoveryOutcomeStore } from '../scoring/discoveryOutcomeStore.js';
import { updateLiveMarketMemory } from '../live/liveMarketMemory.js';

const time = Date.parse('2026-09-08T20:01:00Z'), iso = n => new Date(n).toISOString();
const state = () => ({ liveTradeLimitState: { dateKey: '2026-09-08', positionIntents: {}, intradayStockEntriesToday: 0 } });
const reserve = ledger => ledger.reserve({ symbol: 'BTC/USD', client_order_id: 'local' }, {
  riskNotional: 100, riskReferencePrice: 100, riskDecisionVersion: 'v1', holdCategory: 'crypto', riskBaseQty: 0,
  liveTradeLimitDecision: { isExistingPosition: false } });

test('final synchronous authorization rejects changes during reservation and releases the unsubmitted intent', async () => {
  let allowed = true, posted = 0, settlement;
  const service = createOrderService({ normalizeSymbol: String,
    preTradeRiskGuard: { async assertAllowed() { return { assertCurrent() { if (!allowed) throw new Error('revoked'); } }; } },
    reserveRisk: async () => { allowed = false; return { settle: value => { settlement = value; } }; },
    tradingRequest: async () => { posted++; } });
  await assert.rejects(service.cryptoMarketBuy({ symbol: 'BTC/USD', dollars: 25 }), /revoked/);
  assert.equal(posted, 0); assert.equal(settlement.notSubmitted, true);
});

test('known broker orders are deduplicated, and canceled imports release reserved capital', async () => {
  const s = state();
  let open = [{ client_order_id: 'external', symbol: 'ETH/USD', asset_class: 'crypto', side: 'buy', notional: '120', status: 'new' }];
  let broker = open[0];
  const ledger = createOrderRiskReservations({ state: s, persist() {}, normalizeSymbol: String, getOpenOrders: async () => open,
    lookupOrder: async () => broker });
  assert.equal(await ledger.reconcile([]), 120);
  assert.equal(await ledger.reconcile([]), 120);
  assert.equal(Object.keys(s.orderRiskReservations).length, 1);
  open = []; broker = { ...broker, status: 'canceled', filled_qty: 0 };
  assert.equal(await ledger.reconcile([]), 0);
  assert.equal(s.liveTradeLimitState.positionIntents['ETH/USD'].pending, false);
});

test('unknown-priced pending market quantity fails closed rather than zeroing exposure', async () => {
  const ledger = createOrderRiskReservations({ state: state(), persist() {}, normalizeSymbol: String,
    getOpenOrders: async () => [{ client_order_id: 'external', symbol: 'AAPL', side: 'buy', qty: '2', status: 'new' }], lookupOrder: async () => null });
  await assert.rejects(ledger.reconcile([]), /Pending order value unavailable/);
});

test('unknown holding category reserves intraday entry capacity conservatively', async () => {
  const s = state();
  const row = { client_order_id: 'external', symbol: 'AAPL', side: 'buy', notional: 100, status: 'new' };
  const ledger = createOrderRiskReservations({ state: s, persist() {}, normalizeSymbol: String,
    getOpenOrders: async () => [row], lookupOrder: async () => row });
  await ledger.reconcile([]); await ledger.reconcile([]);
  assert.equal(s.liveTradeLimitState.intradayStockEntriesToday, 1);
  assert.equal(s.liveTradeLimitState.positionIntents.AAPL.unknownHoldCategory, true);
});

test('filled then exited releases only with a fresh post-fill snapshot', async () => {
  let fresh = false;
  const s = state(), ledger = createOrderRiskReservations({ state: s, persist() {}, normalizeSymbol: String,
    lookupOrder: async () => ({ symbol: 'BTC/USD', status: 'filled', filled_qty: 1, filled_at: iso(time) }),
    getPositions: async () => Object.assign([], { stale: !fresh, snapshotAt: time + 1000 }) });
  reserve(ledger);
  await assert.rejects(ledger.reconcile([]), /Post-fill positions unavailable/);
  assert.equal(ledger.consumed('BTC/USD', 'v1'), 100);
  fresh = true;
  assert.equal(await ledger.reconcile([]), 0);
  assert.equal(ledger.consumed('BTC/USD', 'v1'), 100, 'fill must still consume this decision budget after exit');
});

test('partially filled cancellation reserves filled capital until the post-terminal position snapshot', async () => {
  const s = state(), positions = [];
  const ledger = createOrderRiskReservations({ state: s, persist() {}, normalizeSymbol: String,
    lookupOrder: async () => ({ symbol: 'BTC/USD', status: 'canceled', filled_qty: .4, filled_avg_price: 100, updated_at: iso(time) }),
    getPositions: async () => Object.assign([{ symbol: 'BTC/USD', qty: .4, market_value: 40 }], { snapshotAt: time + 1000, stale: false }) });
  reserve(ledger);
  assert.equal(await ledger.reconcile(positions), 0);
  assert.equal(positions[0].market_value, 40);
  assert.equal(ledger.consumed('BTC/USD', 'v1'), 40);
});

test('ambiguous broker outcome never releases a pending reservation', async () => {
  const ledger = createOrderRiskReservations({ state: state(), persist() {}, normalizeSymbol: String, lookupOrder: async () => { throw new Error('timeout'); } });
  reserve(ledger).settle({ error: new Error('timeout') });
  assert.equal(await ledger.reconcile([]), 100);
});

test('risk schema rejects missing and malformed exposure and honors asset buying-power zero', () => {
  const account = { equity: 1000, cash: 500, buying_power: 1000 };
  assert.equal(validBrokerAccount(account), true);
  for (const value of [null, undefined, '', 'invalid', Infinity]) {
    assert.equal(validBrokerPositions([{ symbol: 'AAPL', qty: 1, market_value: value }]), false);
    assert.equal(validBrokerAccount({ ...account, buying_power: value }), false);
  }
  assert.equal(availableBuyingPower({ ...account, crypto_buying_power: 0 }, true), 0);
  assert.equal(availableBuyingPower({ ...account, non_marginable_buying_power: 75 }, true), 75);
  assert.equal(availableBuyingPower(account, true), 500);
});

test('newer nested quote replaces price and spread atomically, without borrowing old spread', () => {
  const row = normalizeCandidateQuote({ price: 100, liveQuoteUpdatedAt: iso(time - 60000), bid: 99, ask: 101,
    spreadAvailable: true, spreadUpdatedAt: iso(time), liveQuote: {
      price: 105, updatedAt: iso(time), source: 'alpaca_crypto_latest', priceIsLive: true } });
  assert.equal(row.price, 105); assert.equal(row.liveQuoteUpdatedAt, iso(time));
  assert.equal(row.spreadAvailable, false); assert.equal(row.bid, undefined); assert.equal(row.spreadUpdatedAt, null);
});

test('newer flat quote supersedes stale nested evidence and uses the same timestamp', () => {
  const row = normalizeCandidateQuote({ price: 100, liveQuoteUpdatedAt: iso(time), liveQuoteSource: 'alpaca_crypto_latest',
    liveQuote: { price: 90, updatedAt: iso(time - 60000) } });
  assert.equal(row.price, 100); assert.equal(row.liveQuote.price, 100); assert.equal(row.liveQuote.updatedAt, iso(time));
  const nested = normalizeCandidateQuote({ liveQuote: { price: 105, updatedAt: time, priceIsLive: true, source: 'alpaca_crypto_latest' } });
  assert.equal(nested.liveQuote.updatedAt, iso(time));
  assert.equal(nested.liveQuoteUpdatedAt, nested.liveQuote.updatedAt);
});

test('quote queue remains bounded, reports saturation, and recovers after a failure', async () => {
  const pump = createAssetQuotePump();
  let release; const seen = [];
  const first = pump('stock', () => new Promise(resolve => { release = resolve; }), () => {});
  await Promise.resolve();
  const jobs = Array.from({ length: 7 }, (_, i) => pump('stock', async () => { if (i === 0) throw new Error('outage'); return [i]; }, rows => seen.push(...rows)).catch(e => e.message));
  await assert.rejects(pump('stock', async () => [], () => {}), /queue full/);
  release([]); await first; await Promise.all(jobs);
  assert.deepEqual(seen, [1, 2, 3, 4, 5, 6]);
  await pump('stock', async () => ['recovered'], rows => seen.push(...rows));
  assert.equal(seen.at(-1), 'recovered');
});

test('durable full-population outcomes survive restart, deduplicate, measure 1/3/5 days, and archive without loss', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'sm-outcomes-test-'));
  try {
    const candidates = Array.from({ length: 100 }, (_, i) => ({ symbol: `C${i}/USD`, price: 100, liveQuoteUpdatedAt: iso(time), cryptoDiscoveryScore: 80 }));
    const options = { assetClass: 'crypto', dayKey: '2026-09-08', now: time };
    let store = createDiscoveryOutcomeStore(directory);
    assert.equal((await store.ingest(candidates, candidates, options)).registered, 100);
    store = createDiscoveryOutcomeStore(directory);
    await store.ingest(candidates, candidates, options);
    for (const days of [1, 3, 5]) {
      const at = time + days * 86400000;
      await store.process(async (asset, symbols) => symbols.map(symbol => ({ symbol, price: 100 + days, liveQuoteUpdatedAt: iso(at) })), { now: at, maxPages: 256 });
    }
    store = createDiscoveryOutcomeStore(directory);
    for (const candidate of candidates) {
      const page = await store.readPage('crypto', options.dayKey, candidate.symbol);
      const rows = page.observations.filter(o => o.symbol === candidate.symbol);
      assert.equal(rows.length, 1);
      for (const day of [1, 3, 5]) assert.equal(rows[0].measurements[day].closeReturnPercent, day);
    }
    assert.ok((await fs.readdir(path.join(directory, 'archive'))).length > 0);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test('missing baseline is recorded honestly and can recover without fabricated outcomes', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'sm-baseline-test-'));
  try {
    const store = createDiscoveryOutcomeStore(directory), options = { assetClass: 'crypto', dayKey: '2026-09-08', now: time };
    const row = { symbol: 'BTC/USD', price: 100 };
    assert.equal((await store.ingest([row], [], options)).missingBaselines, 1);
    assert.equal((await store.readPage('crypto', options.dayKey, row.symbol)).missingBaselines[0].status, 'MISSING_BASELINE_EVIDENCE');
    await store.ingest([{ ...row, liveQuoteUpdatedAt: iso(time) }], [], options);
    const page = await store.readPage('crypto', options.dayKey, row.symbol);
    assert.equal(page.missingBaselines.length, 0); assert.equal(page.observations.length, 1);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test('real provider trades replace snapshot-only memory without fabricating earlier candles', () => {
  const now = Date.now();
  const engineState = { liveMarketMemory: { AAPL: { snapshotOnly: true, price: 100, tickWindow: [], secondCandles: [], updatedAt: iso(now - 1000) } } };
  updateLiveMarketMemory('AAPL', { price: 101, volume: 10, eventType: 'trade', source: 'polygon_ws_trade', liveQuoteUpdatedAt: iso(now) }, {
    engineState, normalizeSymbol: String, getMarketSession: () => 'regular', maxSecondCandles: 60 });
  assert.equal(engineState.liveMarketMemory.AAPL.snapshotOnly, false);
  assert.equal(engineState.liveMarketMemory.AAPL.tickWindow.length, 1);
});

test('provider failure on one durable page does not prevent independent pages being measured', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'sm-outcome-outage-'));
  try {
    const store = createDiscoveryOutcomeStore(directory), rows = [
      { symbol: 'BTC/USD', price: 100, liveQuoteUpdatedAt: iso(time) },
      { symbol: 'ETH/USD', price: 100, liveQuoteUpdatedAt: iso(time) },
    ];
    await store.ingest(rows, rows, { assetClass: 'crypto', dayKey: '2026-09-08', now: time });
    let requests = 0;
    const result = await store.process(async (asset, symbols) => {
      if (++requests === 1) throw new Error('provider outage');
      return symbols.map(symbol => ({ symbol, price: 101, liveQuoteUpdatedAt: iso(time + 86400000) }));
    }, { now: time + 86400000, maxPages: 256 });
    assert.equal(result.errors.length, 1); assert.equal(result.measured, 1);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
