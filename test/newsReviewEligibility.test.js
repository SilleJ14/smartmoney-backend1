import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateNewsReviewEligibility } from '../scoring/newsReviewEligibility.js';
import { calculateEntryQualityScore } from '../scoring/decisionScores.js';

const fixture = () => ({
  symbol: 'AUDIT', price: 100, discoveryScore: 65, preMoveScore: 65,
  technicalBarsFound: 60, technicals: { ema9: 101, ema20: 99, macd: 2, macdSignal: 1, rsi: 60 },
  confirmations: { closeNearHighPercent: 95, aboveVwap: true, fakeBreakout: false, newsRiskAvailable: false },
  phase5SignalQuality: { breakoutRetestConfirmation: true, liquidityStabilityScore: 95,
    antiChaseRisk: 5, exhaustionRisk: 5, spreadWideningRisk: 5 },
  bid: 99.99, ask: 100.01, spreadPercent: 0.02, spreadAvailable: true,
  spreadUpdatedAt: new Date().toISOString(), spreadSource: 'alpaca_latest_stock_quote',
  liveQuoteSource: 'alpaca_latest_stock_quote', requireNewsRiskForEntry: true,
});

test('missing news cannot prevent an otherwise strong Entry research shortlist', () => {
  const quote = fixture();
  const before = structuredClone(quote);
  assert.equal(calculateEntryQualityScore(quote).score, 35);
  assert.equal(evaluateNewsReviewEligibility(quote).eligible, true);
  assert.deepEqual(quote, before);
  assert.equal(calculateEntryQualityScore(quote).approved, false);
  assert.ok(calculateEntryQualityScore(quote).gates.includes('NEWS_RISK_UNAVAILABLE'));
  quote.confirmations.newsRiskAvailable = true;
  quote.confirmations.newsRisk = false;
  assert.equal(calculateEntryQualityScore(quote).approved, true);
});

test('research shortlist retains independent risk blocks, including actual adverse news', () => {
  for (const patch of [
    { confirmations: { ...fixture().confirmations, newsRisk: true } },
    { lateChaseRisk: true }, { setupRevalidationRequired: true },
    { phase5SignalQuality: { ...fixture().phase5SignalQuality, antiChaseRisk: 90 } },
    { bid: 99, ask: 101, spreadPercent: 2 },
    { blockBuying: true }, { buyBlocked: true },
  ]) assert.equal(evaluateNewsReviewEligibility({ ...fixture(), discoveryScore: 90, ...patch }).eligible, false);
});

test('shortlist remains selective and never returns a substitute execution score', () => {
  assert.equal(evaluateNewsReviewEligibility({}, {}, true).eligible, false);
  assert.equal(evaluateNewsReviewEligibility(fixture(), { discoveryOnly: true }).eligible, false);
  assert.equal(evaluateNewsReviewEligibility(fixture(), {}, false).eligible, false);
  const result = evaluateNewsReviewEligibility(fixture());
  assert.deepEqual(Object.keys(result).sort(), ['eligible', 'reason']);
});

test('a measured positive watch candidate gets risk research without lifting its buy block', () => {
  const quote = { ...fixture(), volume: 1000000, percentChange: 2, blockBuying: true };
  const before = structuredClone(quote);
  assert.equal(evaluateNewsReviewEligibility(quote, { discoveryOnly: true }).eligible, true);
  assert.deepEqual(quote, before);
  assert.equal(calculateEntryQualityScore(quote).approved, false);
});
