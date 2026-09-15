import test from 'node:test';
import assert from 'node:assert/strict';
import { eligibleDecisionFixture } from './fixtures/eligibleDecisionFixture.js';
import { buildCurrentDecisionView } from '../scoring/currentDecisionView.js';
import { createOrderService } from '../execution/orderService.js';
import { assertVerifiedQuote } from '../live/quoteAuthorization.js';
import { assertPreTradeRisk } from '../risk/preTradeRiskGate.js';

for (const symbol of ['AAPL', 'BTC/USD']) test(`${symbol}: canonical decision and sizing reach mocked submission, expiry blocks it`, async () => {
  const now = Date.now(), candidate = eligibleDecisionFixture(symbol, now);
  let clock = now, posts = 0;
  const context = {
    account: { equity: 1000, cash: 1000, buying_power: 1000 }, positions: [],
    realCashTradingUnlocked: true, autoTradingEnabled: true, marketOpen: true,
    isCrypto: symbol.includes('/'), price: 100, quoteIsLive: true,
    quoteAgeSeconds: 0, spreadAvailable: true, spreadPercent: .1,
    maxExposurePercent: 50, maxOpenTrades: 5,
    lossBudgetSizing: { approved: true, maxNotional: 25 },
  };
  const check = () => {
    assertVerifiedQuote({ quoteReady: clock - now < 5000 }, symbol);
    const decision = buildCurrentDecisionView(candidate, { now: clock }).authorization;
    assert.equal(decision.approved, true, JSON.stringify(decision.blockingReasons));
    assert.equal(decision.approvedAmount, 25);
    assertPreTradeRisk({ order: { symbol, side: 'buy', notional: decision.approvedAmount }, context });
  };
  const service = createOrderService({ normalizeSymbol: String,
    tradingRequest: async () => { posts++; return { id: 'mock-only' }; },
    preTradeRiskGuard: { assertAllowed: async () => { check(); return { assertCurrent: check }; } } });
  const buy = () => symbol.includes('/') ? service.cryptoMarketBuy({ symbol, dollars: 25 })
    : service.stockBuy({ symbol, dollars: 25, fractionable: true, marketOpen: true, holdCategory: 'intraday', referencePrice: 100 });
  await buy(); assert.equal(posts, 1);
  context.lossBudgetSizing = { approved: false, maxNotional: 0, reason: 'REVOKED' };
  await assert.rejects(buy, /loss budget exceeded/); assert.equal(posts, 1);
  context.lossBudgetSizing = { approved: true, maxNotional: 25 };
  context.emergencyStopActive = true;
  await assert.rejects(buy, /Emergency stop/); assert.equal(posts, 1);
  context.emergencyStopActive = false;
  clock += 5001; await assert.rejects(buy); assert.equal(posts, 1);
});
