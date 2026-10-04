import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { eligibleDecisionFixture } from './fixtures/eligibleDecisionFixture.js';
import { buildCryptoDecisionScore, evaluateCryptoTradeCandidate } from '../scoring/componentScore.js';
import { buildCurrentDecisionView } from '../scoring/currentDecisionView.js';
import { decisionAuthorization } from '../scoring/decisionAuthorization.js';
import { buildCryptoExecutionEconomics } from '../scoring/cryptoExecutionEconomics.js';
import { assessCryptoOrderLiquidity } from '../scoring/cryptoOrderLiquidity.js';
import { evaluateCryptoTradePlan } from '../scoring/cryptoTradePlan.js';
import { cryptoSetupGate } from '../scoring/cryptoSetup.js';
import { assessSnapshotTimes } from '../risk/snapshotTimePolicy.js';
import { evidencePolicy, executionEvidenceIssues, researchExecutionIssues } from '../risk/evidencePolicy.js';
import { cryptoQuoteHasFreshAlpacaBook, isAlpacaCryptoExecutionSource } from '../live/cryptoExecutionQuotes.js';
import {
  evaluateLiveQuoteProviderReadiness,
  getLiveQuoteTimestampMs,
  isFreshLiveQuote as isFreshLiveQuoteHelper,
  isFreshMeasuredSpread,
  isLiveQuoteSource,
} from '../live/liveQuoteCache.js';
import { buildLiveMovers } from '../market-data/liveMovers.js';
import { createCryptoExecutionQuoteRefresher } from '../market-data/cryptoExecutionQuoteRefresh.js';
import {
  cryptoQuoteTop,
  cryptoReferenceCovers,
  effectiveCryptoEvidenceAgeMs,
  effectiveCryptoEvidenceAtMs,
  referenceTimeMs,
  verifyCryptoSignalAgainstReference,
} from '../scoring/cryptoReferenceVerification.js';

// Fixed clock 20 s after a 5-minute bar close, so the completed bar is newer
// than a 30 s-old quote (exercises the price/technical skew rule too).
const now = Date.parse('2026-10-03T12:00:20.000Z');
const iso = (ms) => new Date(ms).toISOString();
const QUIET_MS = 30000;

// A coin whose Alpaca bid/ask and book have been unchanged for 30 s.
function quietCryptoSignal(at = now) {
  const fresh = eligibleDecisionFixture('BTC/USD', at);
  const stamp = iso(at - QUIET_MS);
  const signal = { ...fresh, liveQuoteUpdatedAt: stamp, spreadUpdatedAt: stamp, priceIsLive: false,
    cryptoOrderbook: { ...fresh.cryptoOrderbook, updatedAt: stamp },
    cryptoContextScorecard: { ...fresh.cryptoContextScorecard, calculatedAt: iso(at - 10000) },
    decisionProvenance: { evidencePolicyVersion: 'EVIDENCE_V1', temporalPolicyVersion: 'SNAPSHOT_TIME_V1' } };
  signal.cryptoSetup = cryptoSetupGate(signal, { now: at }).setup;
  return signal;
}
const referenceFor = (patch = {}) => ({ symbol: 'BTC/USD', price: 100.01, tradeAt: now - 1000, receivedAt: now - 900, ...patch });
const verify = (signal, reference) => verifyCryptoSignalAgainstReference(signal, reference, { now });
const variants = () => {
  const base = quietCryptoSignal();
  return {
    verified: { ...base, cryptoReferenceVerification: verify(base, referenceFor()) },
    noReference: base,
    deviation05: { ...base, cryptoReferenceVerification: verify(base, referenceFor({ price: 100.5 })) },
    staleReference6s: { ...base, cryptoReferenceVerification: verify(base, referenceFor({ tradeAt: now - 6000 })) },
  };
};

test('fixture: the quiet coin is blocked today exactly like the live app (stale provider time)', () => {
  const { noReference } = variants();
  const gate = evaluateCryptoTradeCandidate(noReference, { now });
  assert.equal(gate.approved, false);
  for (const reason of ['PRICE_EVIDENCE_STALE', 'SPREAD_EVIDENCE_STALE', 'CRYPTOCONTEXT_EVIDENCE_INCOHERENT',
    'TECHNICAL_EVIDENCE_AFTER_PRICE', 'CRYPTO_ORDERBOOK_STALE', 'QUOTE_UNAVAILABLE', 'SPREAD_STALE', 'ORDER_BOOK_STALE']) {
    assert.ok(gate.reasons.includes(reason), `${reason}: ${gate.reasons.join()}`);
  }
});

test('componentScore quote/spread freshness and the analytical shadow pass only with a fresh close reference', () => {
  const v = variants();
  const verified = buildCryptoDecisionScore(v.verified, { now });
  assert.equal(verified.quoteFreshness.fresh, true);
  assert.equal(verified.spreadFreshness.fresh, true);
  assert.equal(verified.quoteFreshness.ageSeconds, 30, 'provider age is still reported unchanged');
  assert.equal(verified.quoteFreshness.effectiveAgeSeconds, 1);
  assert.equal(verified.quoteFreshness.referenceVerified, true);
  assert.equal(verified.cryptoAnalyticalShadow.X.quoteState.state, 'PASS');
  assert.equal(verified.cryptoAnalyticalShadow.X.spreadState.state, 'PASS');
  assert.equal(verified.cryptoAnalyticalShadow.X.bookState.state, 'PASS');
  assert.ok(!verified.missingCriticalEvidence.includes('freshLiveQuote'));
  assert.ok(!verified.missingCriticalEvidence.includes('freshLiveSpread'));
  for (const name of ['noReference', 'deviation05', 'staleReference6s']) {
    const result = buildCryptoDecisionScore(v[name], { now });
    assert.equal(result.quoteFreshness.fresh, false, name);
    assert.equal(result.spreadFreshness.fresh, false, name);
    assert.ok(result.missingCriticalEvidence.includes('freshLiveQuote'), name);
    assert.ok(result.missingCriticalEvidence.includes('freshLiveSpread'), name);
    assert.notEqual(result.cryptoAnalyticalShadow.X.state, 'PASS', name);
    assert.equal(result.cryptoAnalyticalShadow.X.bookState.reason, 'ORDER_BOOK_STALE', name);
  }
});

test('evaluateCryptoTradeCandidate and the current decision authorization (expiresAt) use the verification', () => {
  const v = variants();
  const gate = evaluateCryptoTradeCandidate(v.verified, { now });
  assert.equal(gate.approved, true, gate.reasons.join());
  const view = buildCurrentDecisionView(v.verified, { now });
  assert.equal(view.authorization.approved, true, view.authorization.blockingReasons.join());
  assert.equal(view.authorization.expiresAt, iso(now - 1000 + 5000), 'crypto expiry = verifiedAt + 5 s');
  assert.equal(view.authorization.priceAt, iso(now - QUIET_MS), 'provider time is never re-stamped');
  assert.equal(view.authorization.referenceVerifiedAt, iso(now - 1000));
  assert.equal(buildCurrentDecisionView(v.verified, { now: now + 4001 }).authorization.approved, false, 'verification expires after 5 s');
  for (const name of ['noReference', 'deviation05', 'staleReference6s']) {
    const blocked = evaluateCryptoTradeCandidate(v[name], { now });
    assert.equal(blocked.approved, false, name);
    const authorization = decisionAuthorization(v[name], blocked, now);
    assert.equal(authorization.approved, false, name);
    assert.ok(authorization.blockingReasons.includes('DECISION_AUTHORIZATION_EXPIRED'), name);
    assert.equal(authorization.expiresAt, iso(now - QUIET_MS + 5000), name);
  }
});

test('order-book gates: execution economics, depth walk and the trade plan honor only a covering verification', () => {
  const v = variants();
  const notional = 25;
  const reasons = (signal) => buildCryptoExecutionEconomics(signal, { notional, now }).reasons;
  assert.ok(!reasons(v.verified).includes('ORDER_BOOK_STALE'));
  const liquidity = (signal) => assessCryptoOrderLiquidity(signal.cryptoOrderbook, { symbol: 'BTC/USD', notional, now,
    referenceVerification: signal.cryptoReferenceVerification });
  assert.equal(liquidity(v.verified).approved, true, liquidity(v.verified).reasons.join());
  assert.equal(evaluateCryptoTradePlan(v.verified, { now, notional, manual: true }).approved, true);
  for (const name of ['noReference', 'deviation05', 'staleReference6s']) {
    assert.ok(reasons(v[name]).includes('ORDER_BOOK_STALE'), name);
    assert.deepEqual(liquidity(v[name]).reasons, ['CRYPTO_ORDERBOOK_STALE'], name);
    assert.equal(evaluateCryptoTradePlan(v[name], { now, notional, manual: true }).approved, false, name);
  }
  // A newer book that the verification did not cover keeps its own provider age.
  const swapped = { ...v.verified, cryptoOrderbook: { ...v.verified.cryptoOrderbook, updatedAt: iso(now - QUIET_MS + 1) } };
  assert.deepEqual(liquidity(swapped).reasons, ['CRYPTO_ORDERBOOK_STALE']);
});

test('quote readiness, snapshot times and research/execution evidence policies use effective crypto times', () => {
  const v = variants();
  const quote = (signal) => ({ symbol: 'BTC/USD', bid: 99.95, ask: 100.05, spreadAvailable: true, spreadSource: 'alpaca_crypto_latest',
    liveQuoteSource: 'alpaca_crypto_latest', liveQuoteUpdatedAt: signal.liveQuoteUpdatedAt, spreadUpdatedAt: signal.spreadUpdatedAt });
  const policy = evidencePolicy('crypto', 'order', 'automatic');
  assert.equal(cryptoQuoteHasFreshAlpacaBook(quote(v.verified), { now, verification: v.verified.cryptoReferenceVerification }), true);
  assert.deepEqual(assessSnapshotTimes(v.verified, { crypto: true, now }).blockers, []);
  assert.equal(assessSnapshotTimes(v.verified, { crypto: true, now }).fields.price.observedAt, iso(now - QUIET_MS));
  assert.deepEqual(researchExecutionIssues(v.verified, policy, now), []);
  const at = (signal, field) => effectiveCryptoEvidenceAtMs({ providerAtMs: Date.parse(signal[field]),
    verification: signal.cryptoReferenceVerification, now, symbol: 'BTC/USD', ...cryptoQuoteTop(signal) });
  assert.deepEqual(executionEvidenceIssues({ priceAt: at(v.verified, 'liveQuoteUpdatedAt'), spreadAt: at(v.verified, 'spreadUpdatedAt'), now, policy }), []);
  for (const name of ['noReference', 'deviation05', 'staleReference6s']) {
    assert.equal(cryptoQuoteHasFreshAlpacaBook(quote(v[name]), { now, verification: v[name].cryptoReferenceVerification }), false, name);
    const blockers = assessSnapshotTimes(v[name], { crypto: true, now }).blockers;
    assert.ok(blockers.includes('PRICE_EVIDENCE_STALE') && blockers.includes('SPREAD_EVIDENCE_STALE'), name);
    assert.ok(researchExecutionIssues(v[name], policy, now).includes('TECHNICAL_EVIDENCE_AFTER_PRICE'), name);
    const issues = executionEvidenceIssues({ priceAt: at(v[name], 'liveQuoteUpdatedAt'), spreadAt: at(v[name], 'spreadUpdatedAt'), now, policy });
    assert.deepEqual(issues, ['PRICE_EVIDENCE_STALE', 'SPREAD_EVIDENCE_STALE'], name);
  }
});

test('crypto execution quote refresh attaches a verification at the decision boundary without re-stamping', async () => {
  const realNow = Date.now();
  const stamp = iso(realNow - QUIET_MS);
  const cached = { symbol: 'BTC/USD', price: 100, bid: 99.95, ask: 100.05, spreadAvailable: true, spreadPercent: 0.1,
    spreadUpdatedAt: stamp, bidAskUpdatedAt: stamp, spreadSource: 'alpaca_crypto_latest', liveQuoteUpdatedAt: stamp,
    liveQuoteSource: 'alpaca_crypto_latest', priceIsLive: false };
  const reference = { symbol: 'BTC/USD', price: 100.02, tradeAt: realNow - 500, receivedAt: realNow - 400 };
  const refresh = (withReference) => createCryptoExecutionQuoteRefresher({
    getLatestQuotes: async () => [cached], normalizeSymbol: (s) => String(s).toUpperCase(),
    updateQuoteCache: (_symbol, quote) => quote,
    verifyReference: (signal) => verifyCryptoSignalAgainstReference(signal, withReference ? reference : null),
  })([{ symbol: 'BTC/USD', assetClass: 'crypto' }]);
  const [verified] = await refresh(true);
  assert.equal(verified.cryptoReferenceVerification.verified, true);
  assert.equal(verified.liveQuoteUpdatedAt, stamp);
  assert.equal(verified.spreadUpdatedAt, stamp);
  assert.equal(buildCryptoDecisionScore(verified).quoteFreshness.fresh, true);
  const [unverified] = await refresh(false);
  assert.equal(unverified.cryptoReferenceVerification.verified, false);
  assert.equal(buildCryptoDecisionScore(unverified).quoteFreshness.fresh, false);
});

test('live movers display: a quiet crypto quote is fresh only with a fresh close reference; stocks unchanged', () => {
  const stamp = iso(now - QUIET_MS);
  const signal = quietCryptoSignal();
  const state = (patch = {}) => ({
    marketOpen: true,
    lastCryptoSignals: [signal],
    lastStockSignals: [{ symbol: 'AAPL', price: 101, previousClose: 100, liveQuoteUpdatedAt: stamp, spreadUpdatedAt: stamp,
      bid: 100.95, ask: 101.05, spreadAvailable: true, liveQuoteSource: 'alpaca_latest_stock_quote',
      spreadSource: 'alpaca_latest_stock_quote', priceIsLive: true }],
    liveQuoteCache: {
      'BTC/USD': { symbol: 'BTC/USD', price: 100, bid: 99.95, ask: 100.05, spreadAvailable: true, spreadPercent: 0.1,
        spreadUpdatedAt: stamp, liveQuoteUpdatedAt: stamp, liveQuoteSource: 'alpaca_crypto_ws',
        spreadSource: 'alpaca_crypto_ws', priceIsLive: true },
      AAPL: { symbol: 'AAPL', price: 101, bid: 100.95, ask: 101.05, spreadAvailable: true, spreadPercent: 0.1,
        spreadUpdatedAt: stamp, liveQuoteUpdatedAt: stamp, liveQuoteSource: 'alpaca_latest_stock_quote',
        spreadSource: 'alpaca_latest_stock_quote', priceIsLive: true },
    },
    ...patch,
  });
  const run = (getCryptoReference) => buildLiveMovers({ state: state(), config: { maxStockPrice: 1000 },
    normalizeSymbol: (s) => String(s || '').toUpperCase(), mergeLiveQuote: (row) => row,
    isCrypto: (s) => String(s).includes('/'), now: () => new Date(now), getCryptoReference });
  const verifiedRows = run((symbol) => (symbol === 'BTC/USD' ? referenceFor() : { symbol, price: 101, tradeAt: now - 100, receivedAt: now - 100 }));
  const btc = verifiedRows.find((row) => row.symbol === 'BTC/USD');
  assert.equal(btc.liveQuoteFresh, true);
  assert.equal(btc.liveSpreadFresh, true);
  assert.equal(btc.liveQuoteAgeSeconds, 30, 'displayed provider age is unchanged');
  assert.equal(btc.liveQuoteEffectiveAgeSeconds, 1);
  assert.equal(btc.cryptoReferenceVerification.verified, true);
  const aapl = verifiedRows.find((row) => row.symbol === 'AAPL');
  assert.ok(aapl, 'stock row is displayed');
  assert.equal(aapl.liveQuoteFresh, false, 'stocks never use a reference');
  assert.equal(aapl.liveSpreadFresh, false);
  assert.equal('cryptoReferenceVerification' in aapl, false);
  for (const reference of [null, referenceFor({ price: 100.5 }), referenceFor({ tradeAt: now - 6000 })]) {
    const row = run(() => reference).find((item) => item.symbol === 'BTC/USD');
    assert.equal(row.liveQuoteFresh, false);
    assert.equal(row.liveSpreadFresh, false);
    assert.equal(row.executionEligibility.approved, false);
  }
});

test('stocks are untouched: a forged verification never changes stock snapshot times or authorization expiry', () => {
  const fresh = eligibleDecisionFixture('AAPL', now);
  const stamp = iso(now - QUIET_MS);
  const forged = { verified: true, version: 'CRYPTO_REFERENCE_V1', symbol: 'AAPL', verifiedAtMs: now - 1000,
    coveredProviderAtMs: [now - QUIET_MS],
    coveredEvidence: ['quote', 'spread'].map((kind) => ({ kind, at: now - QUIET_MS, bid: fresh.bid, ask: fresh.ask })) };
  const stock = { ...fresh, liveQuoteUpdatedAt: stamp, spreadUpdatedAt: stamp, cryptoReferenceVerification: forged };
  assert.ok(assessSnapshotTimes(stock, { crypto: false, now }).blockers.includes('PRICE_EVIDENCE_STALE'));
  const authorization = decisionAuthorization(stock, { approved: true, reasons: [] }, now);
  assert.equal(authorization.expiresAt, iso(now - QUIET_MS + 5000));
  assert.ok(authorization.blockingReasons.includes('DECISION_AUTHORIZATION_EXPIRED'));
  assert.equal('referenceVerifiedAt' in authorization, false);
});

// The production pre-trade guard helpers, executed from server.js itself.
function loadServerFunctions(scope) {
  const source = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  const slice = (start, end) => {
    const from = source.indexOf(start);
    const to = source.indexOf(end, from);
    assert.ok(from >= 0 && to > from, start);
    return source.slice(from, to);
  };
  vm.createContext(scope);
  vm.runInContext([
    slice('function getCryptoReference(symbol)', 'function hydrateCryptoExecutionCandidate('),
    slice('function isPreTradeQuoteReady(', 'async function resolveVerifiedPreTradeQuote('),
    slice('function isLiveQuoteFresh(symbol', 'let lastLiveSignalPushAt'),
  ].join('\n'), scope);
  return { source, scope };
}

test('server pre-trade guard: quote readiness accepts a 30 s-old quote only with a reference checked at that moment', () => {
  const realNow = Date.now();
  const stamp = iso(realNow - QUIET_MS);
  let reference = { symbol: 'BTC/USD', price: 100.01, tradeAt: realNow - 1000, receivedAt: realNow - 900 };
  const scope = {
    coinbaseReferenceStream: { getReference: () => reference },
    engineState: { liveQuoteCache: {} },
    LIVE_ORDER_MAX_QUOTE_AGE_SECONDS: 5,
    normalizeSymbol: (s) => String(s || '').trim().toUpperCase(),
    isCrypto: (s) => String(s?.symbol || s).includes('/'),
    getLiveProviderEvidence: (source, crypto) => evaluateLiveQuoteProviderReadiness(source, { isCrypto: crypto }),
    isAlpacaCryptoExecutionSource, isFreshMeasuredSpread, isLiveQuoteSource, getLiveQuoteTimestampMs,
    isFreshLiveQuote: (quote) => isFreshLiveQuoteHelper(quote, { maxAgeSeconds: 5, isLiveQuoteSource }),
    referenceTimeMs, cryptoReferenceCovers, effectiveCryptoEvidenceAgeMs, verifyCryptoSignalAgainstReference, cryptoQuoteTop,
  };
  const { source } = loadServerFunctions(scope);
  const quiet = { symbol: 'BTC/USD', price: 100, bid: 99.95, ask: 100.05, spreadAvailable: true, spreadPercent: 0.1,
    liveQuoteSource: 'alpaca_crypto_latest', spreadSource: 'alpaca_crypto_latest', priceIsLive: false,
    liveQuoteUpdatedAt: stamp, spreadUpdatedAt: stamp, updatedAt: stamp };
  assert.equal(scope.isPreTradeQuoteReady(quiet, true), true);
  const ages = scope.cryptoEvidenceAges(quiet, scope.verifyCryptoEvidenceNow(quiet, { includeBook: false }), Date.now());
  assert.ok(ages.priceAgeSeconds >= 1 && ages.priceAgeSeconds < 2, String(ages.priceAgeSeconds));
  scope.engineState.liveQuoteCache['BTC/USD'] = quiet;
  assert.equal(scope.isCryptoLiveQuoteFreshOrReferenceVerified('BTC/USD', 5).fresh, true);
  for (const next of [null, { ...reference, price: 100.5 }, { ...reference, tradeAt: realNow - 6000 }]) {
    reference = next;
    assert.equal(scope.isPreTradeQuoteReady(quiet, true), false);
    assert.equal(scope.isCryptoLiveQuoteFreshOrReferenceVerified('BTC/USD', 5).fresh, false);
  }
  reference = { symbol: 'AAPL', price: 100, tradeAt: realNow - 100, receivedAt: realNow - 100 };
  const stockQuote = { ...quiet, symbol: 'AAPL', liveQuoteSource: 'alpaca_latest_stock_quote', spreadSource: 'alpaca_latest_stock_quote', priceIsLive: true };
  assert.equal(scope.isPreTradeQuoteReady(stockQuote, false), false, 'stocks keep provider-time readiness');
  // The final pre-submit check re-reads the reference before the plan and age checks.
  const assertCurrent = source.slice(source.indexOf('assertCurrent() {', source.indexOf('const preTradeRiskGuard =')),
    source.indexOf('let protectionOwnershipOrders'));
  assert.match(assertCurrent, /^assertCurrent\(\) \{\s*if \(!isPreTradeQuoteReady\(quote, cryptoAsset\)\)/);
  const finalCheck = assertCurrent.indexOf('verifyCryptoEvidenceNow({ ...quote, symbol }, { includeBook: false, now: finalCheckAt })');
  assert.ok(finalCheck > 0 && finalCheck < assertCurrent.indexOf('evaluateCryptoTradePlan(sizingSignal'));
});

test('crypto scanner spread merge keeps a quiet verified Alpaca bid/ask instead of discarding it', async () => {
  const { mergeLatestCryptoPriceWithAlpacaSpread } = await import('../strategies/cryptoMarketScanner.js');
  const stamp = iso(now - QUIET_MS);
  const rest = { symbol: 'BTC/USD', price: 100, bid: 99.95, ask: 100.05, spreadAvailable: true, spreadUpdatedAt: stamp,
    bidAskUpdatedAt: stamp, spreadSource: 'alpaca_crypto_latest', liveQuoteSource: 'alpaca_crypto_latest', liveQuoteUpdatedAt: stamp };
  const merged = mergeLatestCryptoPriceWithAlpacaSpread(null, rest, { now, maxSpreadAgeSeconds: 5, symbol: 'BTC/USD', reference: referenceFor() });
  assert.equal(merged.spreadAvailable, true);
  assert.equal(merged.bid, 99.95);
  assert.equal(merged.spreadUpdatedAt, stamp, 'provider spread time is kept');
  for (const reference of [null, referenceFor({ price: 100.5 }), referenceFor({ tradeAt: now - 6000 })]) {
    const blocked = mergeLatestCryptoPriceWithAlpacaSpread(null, rest, { now, maxSpreadAgeSeconds: 5, symbol: 'BTC/USD', reference });
    assert.equal(blocked.spreadAvailable, false);
    assert.equal(blocked.bid, null);
  }
});
