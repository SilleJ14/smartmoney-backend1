import test from 'node:test';
import assert from 'node:assert/strict';
import { assessCryptoSetup, assessBtcContext, completedCryptoBars, cryptoSetupGate } from '../scoring/cryptoSetup.js';
import { assessCryptoOrderLiquidity, assessCryptoTradeEconomics } from '../scoring/cryptoOrderLiquidity.js';
import { evaluateCryptoTradePlan } from '../scoring/cryptoTradePlan.js';
import { calculateDynamicTradeAmount } from '../risk/positionSizing.js';
import { cryptoSetupEvidence } from './fixtures/cryptoSetupFixture.js';
import { createOrderService } from '../execution/orderService.js';
import { buildCryptoDecisionScore, evaluateCryptoTradeCandidate } from '../scoring/componentScore.js';
const now = Date.parse('2026-09-10T18:00:01Z');
const make = () => ({ symbol: 'BTC/USD', price: 100, ...cryptoSetupEvidence(100, now) });

test('crypto retest supplies structure, volume, momentum, EMAs and explicit projected stop/target', () => {
  const setup = assessCryptoSetup(make(), { now });
  assert.equal(setup.eligible, true, JSON.stringify(setup));
  assert.equal(setup.route, 'RETEST_CONTINUATION');
  assert.equal(setup.volumeConfirmed, true);
  assert.equal(setup.ema.required, false);
  assert.ok(setup.ema.ema200 > 0);
  assert.ok(setup.stopPrice < 100 && setup.targetPrice > 100);
  assert.equal(setup.derivatives.funding.required, false);
  assert.equal(setup.derivatives.openInterest.available, false);
  const short = make(); short.chartBars = short.chartBars.slice(-30);
  assert.equal(assessCryptoSetup(short, { now }).ema.ema200, null);
  assert.equal(assessCryptoSetup(short, { now }).eligible, true, 'EMA200 missing is not an entry blocker');
});
test('zero-volume price moves, falling momentum and excessive extension cannot trigger crypto entry', () => {
  const zero = make(); zero.chartBars.forEach(b => { b.volume = 0; });
  assert.ok(assessCryptoSetup(zero, { now }).reasons.includes('CRYPTO_TRADED_VOLUME_NOT_CONFIRMED'));
  assert.equal(assessCryptoSetup({ ...make(), price: 110 }, { now }).eligible, false);
  assert.equal(assessCryptoSetup({ ...make(), price: 95 }, { now }).eligible, false);
});
test('a confirmed breakout is a separate entry route and does not require a retest', () => {
  const s = { symbol: 'BTC/USD', price: 100.45, ...cryptoSetupEvidence(100.2, now) };
  for (let i = 200; i <= 216; i++) Object.assign(s.chartBars[i], { open: 99, close: 99.5, high: 99.8, low: 98.8 });
  s.chartBars[207].low = 97.5;
  s.chartBars[212].low = 98.2;
  Object.assign(s.chartBars[217], { open: 99.5, close: 99.65, high: 99.75, low: 99.2 });
  Object.assign(s.chartBars[218], { open: 99.65, close: 99.7, high: 99.75, low: 99.4 });
  Object.assign(s.chartBars[219], { open: 99.7, close: 100.45, high: 100.55, low: 99.6 });
  const setup = assessCryptoSetup(s, { now });
  assert.equal(setup.route, 'BREAKOUT');
  assert.equal(setup.retest, false);
  assert.equal(setup.higherLows, true);
  assert.equal(setup.eligible, true, JSON.stringify(setup.reasons));
});
test('crypto history rejects malformed, future, gapped and stale observations; incomplete candles do not confirm entries', () => {
  for (const change of [s => s.chartBars[219].low = -1, s => s.chartBars[219].time = now + 1,
    s => s.chartBars[218].time -= 1000, s => s.chartBars.forEach(b => { b.time -= 3600000; })]) {
    const s = make(); change(s); assert.equal(assessCryptoSetup(s, { now }).available, false);
  }
  const s = make(); s.chartBars.push({ ...s.chartBars.at(-1), time: now - 1000 });
  assert.equal(completedCryptoBars(s.chartBars, now).length, 220, 'unfinished candle excluded; completed evidence is unchanged');
  assert.equal(assessCryptoSetup({ ...make(), chartBars: make().chartBars.slice(-12) }, { now }).available, false);
});
test('BTC context is independent, small red moves are not crashes, unavailable context blocks orders', () => {
  const s = make(); assert.equal(cryptoSetupGate(s, { now }).approved, true);
  assert.equal(cryptoSetupGate({ ...s, btcMarketContext: null }, { now }).approved, false);
  const bars = s.chartBars.slice(-24).map((b, i) => { const p = 100 - i * .4; return { ...b, open: p, close: p, high: p + .1, low: p - .1 }; });
  assert.equal(assessBtcContext(bars, { now }).block, true);
  const mild = bars.map((b, i) => { const p = 100 - i * .005; return { ...b, open: p, close: p, high: p + .01, low: p - .01 }; });
  assert.equal(assessBtcContext(mild, { now }).block, false);
});
test('crypto liquidity uses execution venue depth, order size, both book sides and fees', () => {
  const s = make(), book = s.cryptoOrderbook;
  const good = assessCryptoOrderLiquidity(book, { symbol: s.symbol, notional: 100, now });
  assert.equal(good.approved, true);
  assert.ok(good.roundTripCostPercent >= .5);
  const thin = { ...book, bids: [{ p: 99.95, s: 1 }], asks: [{ p: 100.05, s: 1 }] };
  assert.equal(assessCryptoOrderLiquidity(thin, { symbol: s.symbol, notional: 20, now }).approved, false);
  assert.equal(assessCryptoOrderLiquidity({ ...book, location: 'us-1' }, { symbol: s.symbol, notional: 20, now }).approved, false);
  assert.equal(assessCryptoOrderLiquidity({ ...book, updatedAt: new Date(now - 5001).toISOString() }, { symbol: s.symbol, notional: 20, now }).approved, false);
  assert.equal(assessCryptoOrderLiquidity({ ...book, asks: [{ p: 100, s: -1 }] }, { symbol: s.symbol, notional: 20, now }).approved, false);
});
test('net reward/risk gates the order independently of the analysis score', () => {
  const s = make(), plan = evaluateCryptoTradePlan(s, { notional: 100, now });
  assert.equal(plan.approved, true, JSON.stringify(plan));
  assert.ok(plan.economics.rewardRisk >= 1.5);
  assert.equal(assessCryptoTradeEconomics({ ...plan.setup, targetPrice: 100.1 }, plan.liquidity).approved, false);
  const mismatchedBook = { ...s.cryptoOrderbook,
    bids: s.cryptoOrderbook.bids.map(level => ({ ...level, p: level.p * 1.01 })),
    asks: s.cryptoOrderbook.asks.map(level => ({ ...level, p: level.p * 1.01 })),
  };
  const mismatch = evaluateCryptoTradePlan({ ...s, cryptoOrderbook: mismatchedBook }, { notional: 100, now });
  assert.equal(mismatch.approved, false);
  assert.ok(mismatch.reasons.includes('CRYPTO_QUOTE_BOOK_PRICE_MISMATCH'));
});
test('crypto sizing uses bounded starter capital and refuses unavailable depth without increasing the risk minimum', () => {
  const s = { symbol: 'BTC/USD', price: 100, scoringModelVersion: 'SMARTMONEY_CRYPTO_DECISION_V4', ...cryptoSetupEvidence() };
  const input = { account: { equity: 10000, cash: 10000 }, positions: [], signal: s, signalScore: 80,
    config: { maxBotExposurePercent: 20, minAutonomousTradeAmount: 25 }, getExposure: () => 0 };
  const amount = calculateDynamicTradeAmount(input);
  assert.ok(amount > 0 && amount <= 300, String(amount));
  assert.equal(calculateDynamicTradeAmount({ ...input, signal: { ...s, cryptoOrderbook: null } }), 0);
});
test('the shared order service checks crypto depth again after risk reservation, before any provider POST', async () => {
  let clock = now, writes = 0;
  const s = make();
  const check = () => {
    const result = evaluateCryptoTradePlan(s, { now: clock, notional: 100 });
    if (!result.approved) throw new Error(result.reasons.join(';'));
  };
  const service = createOrderService({ normalizeSymbol: String,
    tradingRequest: async () => { writes++; return {}; },
    preTradeRiskGuard: { assertAllowed: async () => { check(); return { assertCurrent: check }; } },
    reserveRisk: async () => { clock += 5001; return { settle() {} }; },
  });
  await assert.rejects(service.cryptoMarketBuy({ symbol: 'BTC/USD', dollars: 100 }), /ORDERBOOK_STALE/);
  assert.equal(writes, 0);
});
test('continuation opportunity can replace low early-D in F without changing D or bypassing mandatory evidence', () => {
  const s = { ...make(), scoringModelVersion: 'SMARTMONEY_CRYPTO_DECISION_V4',
    cryptoDiscoveryScorecard: { score: 55, coverage: 1, calculatedAt: new Date(now).toISOString(), extension: { alreadyExtended: true } },
    barsFound: 220, windowDollarVolume: 1000000, bid: 99.95, ask: 100.05,
    spreadAvailable: true, spreadSource: 'alpaca_crypto_latest', spreadUpdatedAt: new Date(now).toISOString(),
    liveQuoteSource: 'alpaca_crypto_latest', liveQuoteUpdatedAt: new Date(now).toISOString(), priceIsLive: true,
    newsCatalyst: { dataAvailable: true, riskDetected: false } };
  const result = buildCryptoDecisionScore(s, { now });
  assert.equal(result.opportunityBasis, 'RETEST_CONTINUATION');
  assert.equal(result.earlyDiscovery.value, 55);
  assert.equal(result.componentsByName.base.value, result.setup.score);
  assert.equal(result.coreEvidencePass, true, JSON.stringify(result.missingCriticalEvidence));
  assert.equal(evaluateCryptoTradeCandidate(s, { now }).approved, false, 'no central approval or sizing');
  assert.equal(buildCryptoDecisionScore({ ...s, newsCatalyst: { dataAvailable: false } }, { now }).coreEvidencePass, false);
});
