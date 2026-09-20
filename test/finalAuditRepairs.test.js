import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createAlpacaCryptoMarketData } from '../market-data/alpacaCryptoMarketData.js';
import { createRequestCoordinator } from '../market-data/requestCoordinator.js';
import { registerManualExecutionRoutes } from '../routes/manualExecutionRoutes.js';
import { createOrderService } from '../execution/orderService.js';
import { evaluatePreTradeRisk, assertPreTradeRisk } from '../risk/preTradeRiskGate.js';
import { purchasePolicy } from '../risk/evidencePolicy.js';
import { assessSnapshotTimes } from '../risk/snapshotTimePolicy.js';
import { barSnapshot, immutableBarHistory } from '../market-data/barSnapshot.js';
import { linkedRealizedOutcomes } from '../routes/candidateTraceRoutes.js';
import { policyManifest } from '../scoring/policyBundle.js';
import { calculateNewsCatalyst } from '../scoring/newsCatalyst.js';
import { researchExecutionIssues, evidencePolicy } from '../risk/evidencePolicy.js';
import { createDecisionSnapshot } from '../scoring/decisionProvenance.js';

test('concurrent equivalent crypto quote batches share one provider request', async () => {
  let calls = 0;
  const now = new Date();
  const data = createAlpacaCryptoMarketData({ normalizeSymbol: String, now: () => now,
    dataRequest: async () => { calls++; await new Promise(r => setTimeout(r, 5));
      return { quotes: { 'BTC/USD': { bp: 100, ap: 101, t: now.toISOString() }, 'ETH/USD': { bp: 10, ap: 11, t: now.toISOString() } } }; } });
  const results = await Promise.all(Array.from({ length: 8 }, (_, i) => data.getLatestQuotes(i % 2 ? ['BTC/USD','ETH/USD'] : ['ETH/USD','BTC/USD'])));
  assert.equal(calls, 1);
  assert.equal(results.length, 8);
  assert.equal(results[0][0].liveQuoteUpdatedAt, now.toISOString());
});

test('crypto 429 keeps status, stops queued/repeated requests, then recovers', async () => {
  let calls = 0, clock = Date.now();
  const data = createAlpacaCryptoMarketData({ normalizeSymbol: String, now: () => new Date(clock),
    dataRequest: async () => { calls++; throw Object.assign(new Error('limited'), { status: 429, retryAfterMs: 1000 }); } });
  for (let i = 0; i < 3; i++) await assert.rejects(data.getLatestQuotes(['BTC/USD']), e => e.status === 429 && e.retryAfterMs === 1000);
  assert.equal(calls, 1);
  clock += 1001;
  await assert.rejects(data.getLatestQuotes(['BTC/USD']), e => e.status === 429);
  assert.equal(calls, 2);
});

test('request coordination is bounded and coalescing does not turn failures into stale success', async () => {
  let release, calls = 0;
  const request = createRequestCoordinator(async () => { calls++; await new Promise(r => { release = r; }); return calls; }, { concurrency: 1, maxPending: 1 });
  const first = request('/one');
  assert.equal(request('/one'), first);
  await assert.rejects(request('/two'), /capacity/);
  release(); await first;
});

for (const fractionable of [true, false]) for (const holdCategory of ['intraday', 'multi_day']) for (const buyMode of ['dollars', 'shares']) {
  test(`manual ${buyMode} route executes ${fractionable ? 'fractionable' : 'whole'} ${holdCategory} using verified conversion`, async () => {
    const routes = new Map(), orders = [];
    const service = createOrderService({ normalizeSymbol: String, tradingRequest: async (_, options) => {
      orders.push(JSON.parse(options.body)); return { id: 'mock' }; } });
    registerManualExecutionRoutes({ post: (path, ...handlers) => routes.set(path, handlers.at(-1)) }, {
      requireAdmin() {}, normalizeSymbol: String, getMarketOpen: async () => true,
      getAsset: async () => ({ status: 'active', tradable: true, fractionable }),
      getVerifiedStockQuote: async () => ({ quoteReady: true, quote: { current: 10 } }),
      manualStockBuy: service.manualStockBuy, getState: () => ({}), markManagedSymbol() {}, recordOrder() {}, recordFailedOrder() {}, logger: { log() {} },
    });
    const res = { status(n) { this.statusCode = n; return this; }, json(body) { this.body = body; return this; } };
    await routes.get('/manual-buy-stock')({ body: { symbol: 'AAPL', dollars: 25, shares: 2, buyMode, holdCategory } }, res);
    assert.equal(res.body.ok, true);
    assert.equal(orders.length, 1);
    if (buyMode === 'shares') assert.equal(Number(orders[0].qty), 2);
    else assert.ok(Number(orders[0].notional || Number(orders[0].qty) * Number(orders[0].limit_price)) <= 25);
  });
}

test('both actual server sizing expressions enforce the AI-button remaining loss budget', () => {
  const source = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  const expressions = [...source.matchAll(/lossBudgetSizing: (purchase\.requireStrategy \? calculateLossBudgetSizing\(\{[\s\S]*?\}\) : null),/g)];
  assert.equal(expressions.length, 2, 'Initial and immediately-before-submit guard must both calculate sizing');
  for (const [, expression] of expressions) {
    const evaluate = new Function('purchase','calculateLossBudgetSizing','account','managedPositions','CONFIG','sizingSignal','engineState','pendingOrderNotional',`return (${expression});`);
    const options = { automated: false, requireCandidateDecision: true };
    const sizing = evaluate(purchasePolicy(options), () => ({ approved: false, maxNotional: 0, reason: 'EXHAUSTED' }), {}, [], {}, {}, {}, 0);
    const context = { account: { equity: 1000, cash: 1000, buying_power: 1000 }, positions: [], realCashTradingUnlocked: true,
      marketOpen: true, price: 100, quoteAgeSeconds: 0, quoteIsLive: true, spreadAvailable: true, spreadPercent: .1,
      maxExposurePercent: 100, lossBudgetSizing: sizing };
    const gate = evaluatePreTradeRisk({ order: { symbol: 'AAPL', side: 'buy', notional: 25 }, options, context });
    assert.equal(gate.approved, false);
    assert.ok(gate.reasons.some(reason => reason.includes('daily loss budget')));
    assert.equal(evaluate(purchasePolicy({ automated: false }), () => { throw Error('Manual strategy exemption lost'); }, {}, [], {}, {}, {}, 0), null);
  }
});

test('immutable histories reuse identity; mutable replacements and nested mutations cannot', () => {
  const source = [{ t: 1000, c: 1, extra: { count: 1 } }, { t: 1060, c: 2 }];
  const bars = immutableBarHistory(source);
  const first = barSnapshot(bars);
  assert.equal(barSnapshot(bars), first);
  assert.throws(() => { bars[0].extra.count = 2; });
  source[0].extra.count = 2;
  assert.notEqual(barSnapshot(source).id, first.id);
  const second = barSnapshot(source);
  source[1].c = 3;
  assert.notEqual(barSnapshot(source).id, second.id);
});

test('policy manifest identifies every relevant runtime layer without environment values', () => {
  for (const file of ['server.js','risk/preTradeRiskGate.js','scoring/revalidateCandidate.js','execution/orderService.js',
    'risk/snapshotTimePolicy.js','strategies/cryptoMarketScanner.js']) assert.match(policyManifest.dependencies[file], /^[a-f0-9]{64}$/);
  assert.ok(Object.keys(policyManifest.dependencies).every(name => !name.includes('.env') && !name.includes('node_modules')));
});

test('temporal checks distinguish fast execution from slow fundamentals and independent context', () => {
  const now = Date.parse('2026-09-20T12:00:00Z');
  const signal = { liveQuoteUpdatedAt: new Date(now).toISOString(), spreadUpdatedAt: new Date(now - 100).toISOString(),
    fundamentalDataValid: true, fundamentalValidation: { asOf: new Date(now - 86400000).toISOString() },
    requireNewsRiskForEntry: true, confirmations: { newsRiskAvailable: true, newsReviewedAt: new Date(now - 10000).toISOString() },
    marketContextEvidence: { available: true, observations: [{ quoteAt: now - 1000 }, { quoteAt: now - 500 }] } };
  assert.deepEqual(assessSnapshotTimes(signal, { now }).blockers, []);
  assert.ok(assessSnapshotTimes({ ...signal, spreadUpdatedAt: null }, { now }).blockers.includes('SPREAD_EVIDENCE_UNAVAILABLE'));
  assert.ok(assessSnapshotTimes({ ...signal, fundamentalValidation: { asOf: new Date(now - 121 * 86400000).toISOString() } }, { now }).blockers.includes('FUNDAMENTALS_EVIDENCE_STALE'));
  assert.ok(assessSnapshotTimes({ ...signal, marketContextEvidence: { available: true, observations: [{ quoteAt: now - 61000 }] } }, { now }).blockers.includes('STOCKCONTEXT_EVIDENCE_STALE'));
  assert.ok(assessSnapshotTimes({ ...signal, cryptoContextScorecard: { independent: true, calculatedAt: new Date(now - 16 * 60000).toISOString() } }, { now, crypto: true }).blockers.includes('CRYPTOCONTEXT_EVIDENCE_STALE'));
  assert.equal(assessSnapshotTimes({ ...signal, fundamentalDataValid: false, fundamentalValidation: {} }, { now }).fields.fundamentals.used, false);
});

test('history links only confirmed realized trades and never equates no trade to a loss', () => {
  assert.equal(linkedRealizedOutcomes('BTC/USD', []).status, 'UNKNOWN');
  const trade = { symbol: 'BTCUSD', fillConfirmed: true, executionId: 'fill-1', realizedPnl: 5 };
  const result = linkedRealizedOutcomes('BTC/USD', [trade, trade, { ...trade, fillConfirmed: false, executionId: 'bad' }, { ...trade, symbol: 'ETHUSD' }]);
  assert.equal(result.status, 'REALIZED_TRADES_RECORDED');
  assert.equal(result.trades.length, 1);
  assert.equal(result.trades[0].realizedPnl, 5);
});

test('malformed temporal evidence produces unavailable diagnostics without crashing', () => {
  assert.equal(barSnapshot([{ t: 1e30, c: 1 }]).reason, 'BAR_SEQUENCE_INVALID');
  const result = assessSnapshotTimes({ liveQuoteUpdatedAt: 1e30, spreadUpdatedAt: 'invalid',
    marketContextEvidence: { available: true, observations: {} } });
  assert.ok(result.blockers.includes('PRICE_EVIDENCE_UNAVAILABLE'));
  assert.ok(result.blockers.includes('STOCKCONTEXT_EVIDENCE_UNAVAILABLE'));
});

test('new coherent stock and crypto snapshots pass research timing, and stale publications do not', () => {
  const now = Date.now(), at = new Date(now).toISOString();
  const newsCatalyst = calculateNewsCatalyst({ now, dataAvailable: true,
    articles: [{ headline: 'Company raises guidance', datetime: now - 3600000 }] });
  assert.equal(newsCatalyst.publicationWindow.oldestAt, new Date(now - 3600000).toISOString());
  for (const crypto of [false, true]) {
    const signal = { symbol: crypto ? 'BTCUSD' : 'AAPL', asset_class: crypto ? 'crypto' : 'stock',
      liveQuoteUpdatedAt: at, spreadUpdatedAt: at, newsCatalyst,
      technicals: { lastBarAt: new Date(now - 60000).toISOString(), intervalMs: 60000 },
      cryptoSetup: { timeframeMinutes: 1, barUpdatedAt: at } };
    const snapshot = createDecisionSnapshot(signal, {}, now);
    const decision = { ...signal, decisionProvenance: snapshot.provenance };
    assert.deepEqual(researchExecutionIssues(decision, evidencePolicy(crypto ? 'crypto' : 'stock', 'order', 'automatic'), now), []);
    const expired = { ...decision, newsCatalyst: { ...newsCatalyst,
      publicationWindow: { oldestAt: new Date(now - 73 * 3600000).toISOString(), newestAt: at } } };
    assert.ok(researchExecutionIssues(expired, evidencePolicy(crypto ? 'crypto' : 'stock', 'order', 'automatic'), now)
      .includes('OLDESTNEWSPUBLICATION_EVIDENCE_STALE'));
    assert.deepEqual(researchExecutionIssues(expired, evidencePolicy(crypto ? 'crypto' : 'stock', 'order', 'manual'), now), []);
  }
});

test('AI stock button reaches the real order guard; depleted budget prevents reservation and broker POST', async () => {
  const routes = new Map(), now = new Date().toISOString();
  let remaining = 0, reservations = 0, submissions = 0;
  const source = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  const expression = source.match(/lossBudgetSizing: (purchase\.requireStrategy \? calculateLossBudgetSizing\(\{[\s\S]*?\}\) : null),/)[1];
  const sizing = new Function('purchase','calculateLossBudgetSizing','account','managedPositions','CONFIG','sizingSignal','engineState','pendingOrderNotional',`return (${expression});`);
  const service = createOrderService({ normalizeSymbol: String,
    preTradeRiskGuard: { assertAllowed: async (order, options) => {
      const lossBudgetSizing = sizing(purchasePolicy(options), () => ({ approved: remaining > 0, maxNotional: remaining }), {}, [], {}, {}, {}, 0);
      assertPreTradeRisk({ order, options, context: { account: { equity: 1000, cash: 1000, buying_power: 1000 }, positions: [],
        realCashTradingUnlocked: true, marketOpen: true, price: 100, quoteAgeSeconds: 0, quoteIsLive: true,
        spreadAvailable: true, spreadPercent: .1, maxExposurePercent: 100, lossBudgetSizing } });
    } },
    reserveRisk: async () => { reservations++; return { settle() {} }; },
    tradingRequest: async () => { submissions++; return { id: 'mock-order' }; } });
  registerManualExecutionRoutes({ post: (path, ...handlers) => routes.set(path, handlers.at(-1)) }, {
    requireAdmin() {}, normalizeSymbol: String, getMarketOpen: async () => true,
    getAsset: async () => ({ status: 'active', tradable: true, fractionable: true }),
    getVerifiedStockQuote: async () => ({ quoteReady: true, quote: { current: 100, price: 100, bid: 99.95, ask: 100.05,
      spreadPercent: .1, spreadAvailable: true, priceIsLive: true, updatedAt: now, spreadUpdatedAt: now } }),
    evaluateStockCandidate: () => ({ approved: true }), manualStockBuy: service.manualStockBuy,
    getState: () => ({ lastStockSignals: [{ symbol: 'AAPL', assetClass: 'stock', recommendedTradeAmount: 25, decisionUpdatedAt: now }] }),
    markManagedSymbol() {}, recordOrder() {}, recordFailedOrder() {}, logger: { log() {} },
  });
  const call = async () => {
    const res = { status(n) { this.statusCode = n; return this; }, json(body) { this.body = body; return this; } };
    await routes.get('/buy-stock-signal')({ body: { symbol: 'AAPL', dollars: 25, holdCategory: 'intraday' } }, res);
    return res;
  };
  const rejected = await call();
  assert.equal(rejected.body.ok, false);
  assert.match(rejected.body.error, /daily loss budget/);
  assert.equal(reservations, 0); assert.equal(submissions, 0);
  remaining = 25;
  assert.equal((await call()).body.ok, true);
  assert.equal(reservations, 1); assert.equal(submissions, 1);
});
