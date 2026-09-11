import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStockDecisionScore, calculateEntryQualityScore, evaluateStockTradeCandidate } from '../scoring/decisionScores.js';
import { normalizeSignalScoreCompleteness } from '../scoring/signalScoreCompleteness.js';
import { installCentralDecision } from '../scoring/installCentralDecision.js';
import { revalidateCandidate } from '../scoring/revalidateCandidate.js';
import { buildCryptoDecisionScore, evaluateCryptoTradeCandidate } from '../scoring/componentScore.js';

function fixture() {
  const time = new Date().toISOString();
  return { symbol: 'AAPL', price: 100, bid: 99.99, ask: 100.01, spreadAvailable: true,
    liveQuoteUpdatedAt: time, spreadUpdatedAt: time, liveQuoteSource: 'tradier_stock_quote',
    spreadSource: 'tradier_stock_quote', priceIsLive: true, technicalBarsFound: 60,
    discoveryScorecard: { score: 80, coverage: 1, canonicalExtensionEvidencePass: true },
    contextScore: 80, riskPortfolioScore: 80, fundamentalScore: 80, fundamentalDataValid: true,
    confirmations: { aboveVwap: true, fakeBreakout: false, closeNearHighPercent: 95 },
    technicals: { ema9: 100, ema20: 99, macd: 2, macdSignal: 1, rsi: 60 },
    phase5SignalQuality: { liquidityStabilityScore: 90, antiChaseRisk: 10, breakoutRetestConfirmation: true },
    approved: false, backendApproved: false, autoTradeApproved: false, qualifiedToBuy: false,
  };
}
test('measured rejected entry keeps a numeric F without changing execution gates', () => {
  const signal = fixture(); signal.phase5SignalQuality.antiChaseRisk = 90;
  signal.entryQualityScorecard = calculateEntryQualityScore(signal);
  const evidence = buildStockDecisionScore(signal);
  assert.equal(evidence.coreEvidencePass, false); assert.equal(evidence.analysisEvidencePass, true);
  installCentralDecision(signal, { stockDecisionEvidence: evidence, finalDecisionScore: evidence.score, action: 'WATCH' });
  const result = normalizeSignalScoreCompleteness(signal);
  assert.equal(typeof result.stockDecisionScore, 'number'); assert.equal(evaluateStockTradeCandidate(result).approved, false);
});
test('fresh evidence restores a lost F but not approval or sizing', () => {
  const signal = fixture(); signal.entryQualityScorecard = calculateEntryQualityScore(signal);
  const evidence = buildStockDecisionScore(signal); assert.equal(evidence.coreEvidencePass, true);
  installCentralDecision(signal, { stockDecisionEvidence: evidence, finalDecisionScore: evidence.score, action: 'WATCH' });
  const stale = revalidateCandidate(signal, { ...signal, bid: undefined, ask: undefined,
    spreadAvailable: false, spreadUpdatedAt: null, bidAskUpdatedAt: null, spreadPercent: null });
  assert.equal(stale.stockDecisionScore, null);
  assert.equal(stale.lastMeasuredAssessment.final, signal.stockDecisionScore);
  assert.equal(stale.lastMeasuredAssessment.at, signal.decisionUpdatedAt);
  const restored = revalidateCandidate(stale, { ...stale, bid: signal.bid, ask: signal.ask,
    spreadAvailable: true, spreadUpdatedAt: signal.spreadUpdatedAt, spreadSource: signal.spreadSource });
  assert.equal(typeof restored.stockDecisionScore, 'number');
  assert.equal(restored.approved, false); assert.equal(restored.finalApprovedTradeAmount, 0);
  assert.ok(restored.executionEligibility.reasons.includes('RECOVERED_SCORE_REQUIRES_CENTRAL_REVIEW'));
});

test('current decision view ignores contradictory raw/old gate warnings and does not grant permission', () => {
  const signal = fixture(); signal.entryQualityScorecard = calculateEntryQualityScore(signal);
  const evidence = buildStockDecisionScore(signal);
  installCentralDecision(signal, { stockDecisionEvidence: evidence, finalDecisionScore: evidence.score, action: 'WATCH' });
  signal.missingEvidenceReasons = ['FINAL_SCORE_INVALID', 'SPREAD_UNAVAILABLE'];
  signal.finalStockExecutionGate = { approved: false, reasons: ['SPREAD_UNAVAILABLE'] };
  signal.raw = { missingEvidenceReasons: ['FINAL_SCORE_INVALID'] };
  const result = normalizeSignalScoreCompleteness(signal);
  assert.equal(typeof result.stockDecisionScore, 'number');
  assert.ok(!result.currentDecision.reasons.includes('FINAL_SCORE_INVALID'));
  assert.ok(!result.currentDecision.reasons.includes('SPREAD_UNAVAILABLE'));
  assert.equal(result.approved, false);
  assert.ok(result.currentDecision.reasons.includes('EXPLICIT_APPROVAL_MISSING'));
});
test('missing history cannot become F and large price drift still requires reassessment', () => {
  const signal = fixture(); signal.discoveryScorecard.canonicalExtensionEvidencePass = false;
  assert.equal(buildStockDecisionScore(signal).analysisEvidencePass, false);
  signal.centralAutonomousDecisionCore = {}; signal.decisionReferencePrice = 100;
  assert.equal(revalidateCandidate(signal, { ...signal, price: 110 }).stockDecisionScore, null);
});

test('crypto stale spread then recovery restores measured E/F without enabling a buy', () => {
  const now = Date.now(), time = new Date(now).toISOString();
  const signal = { symbol: 'BTC/USD', price: 100, current: 100,
    cryptoDiscoveryScorecard: { score: 80, coverage: 1, calculatedAt: time, extension: { alreadyExtended: false } },
    newsCatalyst: { dataAvailable: true, riskDetected: false }, barsFound: 30, windowDollarVolume: 1000000,
    bid: 99.95, ask: 100.05, spreadAvailable: true, priceIsLive: true,
    liveQuoteUpdatedAt: time, spreadUpdatedAt: time, liveQuoteSource: 'alpaca_crypto_latest', spreadSource: 'alpaca_crypto_latest',
    approved: false, backendApproved: false, autoTradeApproved: false, qualifiedToBuy: false,
  };
  const evidence = buildCryptoDecisionScore(signal, { now }); assert.equal(evidence.coreEvidencePass, true);
  installCentralDecision(signal, { action: 'WATCH', cryptoDecisionScore: evidence.score,
    cryptoDecisionEvidence: evidence }, { crypto: true, now });
  const stale = revalidateCandidate(signal, { ...signal, spreadUpdatedAt: new Date(now - 60000).toISOString() }, { now });
  assert.equal(stale.cryptoDecisionScoreAvailable, false);
  const recovered = revalidateCandidate(stale, { ...stale, spreadUpdatedAt: time }, { now });
  assert.equal(recovered.cryptoDecisionScoreAvailable, true);
  assert.equal(recovered.cryptoEntryScoreAvailable, true);
  assert.equal(evaluateCryptoTradeCandidate(recovered, { now }).approved, false);
  assert.equal(recovered.finalApprovedTradeAmount, 0);
});
