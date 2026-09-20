import test from 'node:test';
import assert from 'node:assert/strict';
import { createOrderService } from '../execution/orderService.js';
import { assertPreTradeRisk } from '../risk/preTradeRiskGate.js';
import { evaluateCryptoTradePlan } from '../scoring/cryptoTradePlan.js';
import { registerManualExecutionRoutes } from '../routes/manualExecutionRoutes.js';

const context = () => ({ account: { equity: 1000, cash: 1000, buying_power: 1000 }, positions: [],
  realCashTradingUnlocked: true, autoTradingEnabled: false, marketOpen: true,
  price: 100, quoteAgeSeconds: 0, quoteIsLive: true, spreadAvailable: true, spreadPercent: .1,
  maxExposurePercent: 0, maxQuoteAgeSeconds: 5, maxSpreadPercent: 1 });

for (const crypto of [false, true]) test(`manual ${crypto ? 'crypto' : 'stock'} bypasses bot policy but retains execution protections`, async () => {
  let overrides = {}, calls = 0;
  const service = createOrderService({ normalizeSymbol: s => s, tradingRequest: async () => { calls++; return { id: 'mock' }; },
    preTradeRiskGuard: { assertAllowed(order, options) {
      if (options.automated !== false || options.requireCandidateDecision) throw new Error('Canonical score/entry required');
      return assertPreTradeRisk({ order, options, context: { ...context(), isCrypto: crypto, ...overrides } });
    } } });
  const buy = () => crypto ? service.cryptoMarketBuy({ symbol: 'BTCUSD', dollars: 25, manual: true })
    : service.manualStockBuy({ symbol: 'AAPL', dollars: 25, marketOpen: true, fractionable: true, holdCategory: 'intraday' });
  await buy();
  assert.equal(calls, 1);
  for (const blocked of [{ dailyLossLocked: true }, { emergencyStopActive: true }, { profitLocked: true },
    { quoteAgeSeconds: 60 }, { spreadAvailable: false }, { safetyReconciliationRequired: true },
    { account: { equity: 1000, cash: 1, buying_power: 1 } },
    { accountExposurePositions: [{ symbol: 'OTHER', market_value: 990 }], maxAccountExposurePercent: 100 },
    { liveTradeLimitDecision: { approved: false, reasons: ['Position limit'] } }]) {
    overrides = blocked;
    await assert.rejects(buy);
    assert.equal(calls, 1);
  }
  overrides = {};
  if (crypto) await assert.rejects(service.cryptoMarketBuy({ symbol: 'BTCUSD', dollars: 25 }), /Canonical/);
  else await assert.rejects(service.manualStockBuy({ symbol: 'AAPL', dollars: 25, marketOpen: true,
    fractionable: true, holdCategory: 'intraday', requireCandidateDecision: true }), /Canonical/);
});

test('AI-sized manual orders still enforce bot cap', () => {
  assert.throws(() => assertPreTradeRisk({ order: { symbol: 'AAPL', side: 'buy', notional: 25 },
    options: { automated: false, requireCandidateDecision: true }, context: context() }), /Maximum bot exposure/);
});

test('manual crypto needs execution depth but no strategy setup', () => {
  const now = Date.now();
  const signal = { symbol: 'BTCUSD', price: 100, cryptoOrderbook: { symbol: 'BTCUSD',
    source: 'alpaca_crypto_orderbook', location: 'us', updatedAt: new Date(now).toISOString(),
    bids: [{ p: 99.9, s: 100 }], asks: [{ p: 100.1, s: 100 }] } };
  assert.equal(evaluateCryptoTradePlan(signal, { now, notional: 25, manual: true }).approved, true);
  assert.equal(evaluateCryptoTradePlan(signal, { now, notional: 25 }).approved, false);
  assert.equal(evaluateCryptoTradePlan(signal, { now: now + 6000, notional: 25, manual: true }).approved, false);
  assert.equal(evaluateCryptoTradePlan(signal, { now, notional: 2000, manual: true }).approved, false);
});

test('manual crypto route accepts an unscored asset, still blocks failed verification', async () => {
  const routes = new Map(), calls = [];
  let quoteReady = true;
  registerManualExecutionRoutes({ post: (path, ...handlers) => routes.set(path, handlers.at(-1)) }, {
    requireAdmin() {}, normalizeSymbol: s => s,
    getAsset: async () => ({ status: 'active', tradable: true, asset_class: 'crypto' }),
    getVerifiedCryptoQuote: async () => ({ quoteReady }),
    manualCryptoBuy: async input => { calls.push(input); return { id: 'mock' }; },
    getState: () => ({ lastCryptoSignals: [] }), markManagedSymbol() {}, recordOrder() {}, recordFailedOrder() {},
  });
  const response = () => ({ status(n) { this.statusCode = n; return this; }, json(b) { this.body = b; return this; } });
  const req = { body: { symbol: 'BTCUSD', dollars: 25 } };
  const good = response();
  await routes.get('/manual-buy-crypto')(req, good);
  assert.equal(good.body.ok, true);
  assert.deepEqual(calls, [{ symbol: 'BTCUSD', dollars: 25, manual: true }]);
  quoteReady = false;
  const bad = response();
  await routes.get('/manual-buy-crypto')(req, bad);
  assert.equal(bad.statusCode, 409);
  assert.equal(calls.length, 1);
});
