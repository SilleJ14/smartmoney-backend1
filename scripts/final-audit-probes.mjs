// Read-only audit probes: all provider/broker requests below are mocks.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createAlpacaCryptoMarketData } from '../market-data/alpacaCryptoMarketData.js';
import { registerManualExecutionRoutes } from '../routes/manualExecutionRoutes.js';
import { createOrderService } from '../execution/orderService.js';
import { evaluatePreTradeRisk } from '../risk/preTradeRiskGate.js';
import { purchasePolicy } from '../risk/evidencePolicy.js';
import { policyManifest } from '../scoring/policyBundle.js';

const results = [];
const normalizeSymbol = s => String(s).toUpperCase();
const now = new Date();
let requests = 0;
const market = createAlpacaCryptoMarketData({ normalizeSymbol, now: () => now,
  dataRequest: async () => { requests++; await new Promise(resolve => setTimeout(resolve, 10));
    return { quotes: { 'BTC/USD': { bp: 100, ap: 101, t: now.toISOString() } } }; } });
await Promise.all(Array.from({ length: 8 }, () => market.getLatestQuotes(['BTC/USD'])));
assert.equal(requests, 8);
results.push({ finding: 'Identical concurrent crypto quote calls are not coalesced', requests });

let throttledRequests = 0;
const throttled = createAlpacaCryptoMarketData({ normalizeSymbol, now: () => now,
  dataRequest: async () => { throttledRequests++; throw Object.assign(new Error('too many requests'), { status: 429 }); } });
const errors = [];
for (let i = 0; i < 2; i++) { try { await throttled.getLatestQuotes(['BTC/USD']); } catch (error) { errors.push(error); } }
assert.equal(throttledRequests, 2);
assert.equal(errors[0].status, undefined);
results.push({ finding: 'Immediate retry after crypto 429 still reaches provider; wrapper loses status',
  requests: throttledRequests, propagatedStatus: errors[0].status ?? null });

let brokerCalls = 0;
const service = createOrderService({ normalizeSymbol,
  tradingRequest: async () => { brokerCalls++; return { id: 'MOCK_ONLY' }; } });
const routes = new Map();
registerManualExecutionRoutes({ post: (route, ...handlers) => routes.set(route, handlers.at(-1)) }, {
  requireAdmin() {}, normalizeSymbol, getMarketOpen: async () => true,
  getAsset: async () => ({ status: 'active', tradable: true, fractionable: true }),
  getStockQuote: async () => ({ current: 10 }), manualStockBuy: service.manualStockBuy,
  getState: () => ({ aiManagedSymbols: [] }), markManagedSymbol() {}, recordOrder() {}, recordFailedOrder() {}, logger: { log() {} },
});
const response = { status(n) { this.statusCode = n; return this; }, json(body) { this.body = body; return this; } };
await routes.get('/manual-buy-stock')({ body: { symbol: 'AAPL', dollars: 100, buyMode: 'dollars', holdCategory: 'multi_day' } }, response);
assert.equal(response.body.ok, false);
assert.match(response.body.error, /price/i);
assert.equal(brokerCalls, 0);
results.push({ finding: 'Fractionable multi-day dollar manual route fails before broker', response: response.body });

// Evaluate the exact current server context expression, not a rewritten approximation.
const source = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
const expression = source.match(/lossBudgetSizing: (options\.automated !== false \? calculateLossBudgetSizing\(\{[\s\S]*?\}\) : null),/)[1];
const compute = new Function('options', 'calculateLossBudgetSizing', 'account', 'managedPositions', 'CONFIG', 'sizingSignal', 'engineState', 'pendingOrderNotional', `return (${expression});`);
const options = { automated: false, requireCandidateDecision: true };
const context = { account: { equity: 1000, cash: 1000, buying_power: 1000 }, positions: [],
  realCashTradingUnlocked: true, autoTradingEnabled: true, marketOpen: true, price: 100,
  quoteAgeSeconds: 0, quoteIsLive: true, spreadAvailable: true, spreadPercent: .1,
  maxExposurePercent: 100, maxQuoteAgeSeconds: 5, maxSpreadPercent: 1 };
const deniedBudget = { approved: false, maxNotional: 0, reason: 'DAILY_RISK_EXHAUSTED' };
const lossBudgetSizing = compute(options, () => deniedBudget, context.account, [], {}, {}, {}, 0);
assert.equal(purchasePolicy(options).requireStrategy, true);
assert.equal(lossBudgetSizing, null);
const order = { symbol: 'AAPL', side: 'buy', notional: 25 };
const bypass = evaluatePreTradeRisk({ order, options, context: { ...context, lossBudgetSizing } });
const enforced = evaluatePreTradeRisk({ order, options, context: { ...context, lossBudgetSizing: deniedBudget } });
assert.equal(bypass.approved, true);
assert.equal(enforced.approved, false);
results.push({ finding: 'AI-button options skip current stop-distance/daily-risk sizing calculation',
  automaticPolicy: purchasePolicy(options).purchaseType, guardApprovedWithoutBudget: bypass.approved,
  guardApprovedWithExhaustedBudget: enforced.approved,
  scope: 'Exact server context expression plus real risk gate; not a full HTTP order test' });

results.push({ finding: 'Policy source bundle is partial', archivedFiles: policyManifest.files,
  missingCentralServer: !policyManifest.files.includes('server.js'),
  missingAuthorizationGate: !policyManifest.files.includes('risk/preTradeRiskGate.js') });
console.log(JSON.stringify({ mockOnly: true, results }, null, 2));
