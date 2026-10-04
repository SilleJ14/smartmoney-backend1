// End to end through the PRODUCTION final pre-trade guard (server.js
// `preTradeRiskGuard` and its server.js helpers, extracted verbatim) and the
// production order service, for a price-protected crypto buy of a quiet coin.
// Only network boundaries are faked: the Coinbase reference stream, Alpaca
// asset metadata (increments), Alpaca market data (latest quote / order book,
// served through the real adapter) and the broker POST. No real orders.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parse } from 'acorn';
import { eligibleDecisionFixture } from './fixtures/eligibleDecisionFixture.js';
import { TEST_CRYPTO_ASSET } from './fixtures/cryptoLimitPricing.js';
import { createOrderService } from '../execution/orderService.js';
import { buildCryptoLimitBuyOrder, floorToIncrement } from '../execution/cryptoLimitOrder.js';
import { createAlpacaCryptoMarketData } from '../market-data/alpacaCryptoMarketData.js';
import { purchasePolicy, isDiscretionaryManualPurchase, executionEvidenceIssues, researchExecutionIssues } from '../risk/evidencePolicy.js';
import { assertVerifiedQuote } from '../live/quoteAuthorization.js';
import { resolvePreTradeQuote } from '../live/preTradeQuoteResolver.js';
import { evaluateScaleInEvidence } from '../risk/scaleInEvidence.js';
import { riskPolicyVersion, assertRiskPolicyVersion } from '../risk/authorizationVersion.js';
import { authorizationFingerprint, assertAuthorizationUnchanged } from '../scoring/analyticalAuthorization.js';
import { evaluateCryptoTradePlan } from '../scoring/cryptoTradePlan.js';
import { calculateLossBudgetSizing } from '../risk/lossBudgetSizing.js';
import { assertPreTradeRisk } from '../risk/preTradeRiskGate.js';
import { evaluateLiveTradeLimits, ensureLiveTradeLimitDay } from '../risk/liveTradeLimits.js';
import { outstandingOrderNotional } from '../risk/orderRiskReservations.js';
import { dedupeSignalsByCanonicalAuthority } from '../scoring/canonicalSignalRank.js';
import { getApprovedTradeAmount } from '../scoring/approvedSizing.js';
import { buildCryptoDecisionScore, evaluateCryptoTradeCandidate } from '../scoring/componentScore.js';
import { installCentralDecision } from '../scoring/installCentralDecision.js';
import { evaluateStockTradeCandidate } from '../scoring/decisionScores.js';
import { revalidateCandidate } from '../scoring/revalidateCandidate.js';
import { cryptoSetupGate } from '../scoring/cryptoSetup.js';
import { CRYPTO_MAX_ENTRY_SPREAD_PERCENT } from '../scoring/cryptoScoring.js';
import { isAlpacaCryptoExecutionSource } from '../live/cryptoExecutionQuotes.js';
import {
  evaluateLiveQuoteProviderReadiness,
  getLiveQuoteTimestampMs,
  getSpreadAgeSeconds,
  isFreshLiveQuote as isFreshLiveQuoteHelper,
  isFreshMeasuredSpread,
  isLiveQuoteSource,
} from '../live/liveQuoteCache.js';
import {
  assessCryptoQuoteSupersession,
  cryptoPriceLiveOrVerified,
  cryptoQuoteTop,
  cryptoReferenceCovers,
  effectiveCryptoEvidenceAgeMs,
  referenceTimeMs,
  verifyCryptoSignalAgainstReference,
} from '../scoring/cryptoReferenceVerification.js';

const SYMBOL = 'BTC/USD';
const APPROVED_NOTIONAL = 25;
const iso = (ms) => new Date(ms).toISOString();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const serverSource = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
const serverAst = parse(serverSource, { ecmaVersion: 'latest', sourceType: 'module' });
function serverDeclaration(name) {
  for (const node of serverAst.body) {
    const declaration = node.type === 'ExportNamedDeclaration' ? node.declaration : node;
    if (declaration?.type === 'FunctionDeclaration' && declaration.id?.name === name) {
      return serverSource.slice(declaration.start, declaration.end);
    }
    if (declaration?.type === 'VariableDeclaration') {
      for (const item of declaration.declarations) {
        if (item.id?.type === 'Identifier' && item.id.name === name && item.init) {
          return `const ${name} = ${serverSource.slice(item.init.start, item.init.end)};`;
        }
      }
    }
  }
  throw new Error(`server.js no longer declares ${name} at top level`);
}
// The guard and every server.js helper on its crypto path, evaluated together.
const SERVER_FUNCTIONS = [
  'currentRiskPolicyVersion', 'isFreshLiveQuote', 'isPolygonLiveConnected', 'isFinnhubLiveConnected',
  'getLiveProviderEvidence', 'getProviderQuoteTimestampMs', 'getCryptoReference', 'verifyCryptoEvidenceNow',
  'cryptoEvidenceAges', 'isPreTradeQuoteReady', 'resolveVerifiedPreTradeQuote', 'cryptoQuoteReliesOnReference',
  'assertCryptoQuoteNotSuperseded', 'pickQuoteEvidence', 'priceCryptoLimitBuy', 'resolveManualCryptoLimitAsk',
  'preTradeRiskGuard',
];
function loadServerGuard(deps) {
  const body = `${SERVER_FUNCTIONS.map(serverDeclaration).join('\n')}\nreturn { ${SERVER_FUNCTIONS.join(', ')} };`;
  return new Function(...Object.keys(deps), body)(...Object.values(deps));
}

// A canonical crypto decision issued by the central core (installCentralDecision)
// while the coin's Alpaca quote/book had been unchanged (quiet) for
// `quoteAgeMs` and a fresh reference trade verified them.
function canonicalDecision(at, quoteAgeMs, policyVersion) {
  const fresh = eligibleDecisionFixture(SYMBOL, at);
  const stamp = iso(at - quoteAgeMs);
  const signal = { ...fresh, liveQuoteUpdatedAt: stamp, spreadUpdatedAt: stamp, bidAskUpdatedAt: stamp,
    priceIsLive: quoteAgeMs <= 4000,
    cryptoOrderbook: { ...fresh.cryptoOrderbook, updatedAt: stamp },
    cryptoContextScorecard: { ...fresh.cryptoContextScorecard, calculatedAt: iso(at - 10000) } };
  signal.cryptoSetup = cryptoSetupGate(signal, { now: at }).setup;
  signal.cryptoReferenceVerification = verifyCryptoSignalAgainstReference(signal,
    { symbol: SYMBOL, price: 100.01, tradeAt: at - 500, receivedAt: at - 400 }, { now: at });
  const evidence = buildCryptoDecisionScore(signal, { now: at });
  installCentralDecision(signal, { action: 'ALLOW', updatedAt: iso(at), finalDecisionScore: evidence.score,
    cryptoDecisionScore: evidence.score, cryptoDecisionEvidence: evidence, riskPolicyVersion: policyVersion,
    provenance: { evidencePolicyVersion: 'EVIDENCE_V1', temporalPolicyVersion: 'SNAPSHOT_TIME_V1' } }, { crypto: true, now: at });
  Object.assign(signal, { finalApprovedTradeAmount: APPROVED_NOTIONAL, finalTradeAmount: APPROVED_NOTIONAL,
    recommendedTradeAmount: APPROVED_NOTIONAL });
  return signal;
}

const BOOK_TOPS = {
  same: { bid: 99.95, ask: 100.05 },
  moved: { bid: 100.00, ask: 100.10 },
};

function buildScenario({
  quoteAgeMs = 30000,
  reference = (now) => ({ symbol: SYMBOL, price: 100.01, tradeAt: now - 500, receivedAt: now - 400 }),
  freshBook = 'quiet', // 'quiet': unchanged, as old as the quote; 'moved': newer, different top; 'newerSame': newer, same top
  reserveDelayMs = 0,
} = {}) {
  const at = Date.now();
  const stamp = iso(at - quoteAgeMs);
  const CONFIG = { realCashTradingUnlocked: true, maxBotExposurePercent: 80, maxOpenTrades: 8,
    maxAccountExposurePercent: 100, minStockPrice: 0.5, maxCryptoOpenTrades: 3 };
  const engineState = {
    lastStockSignals: [], lastCryptoSignals: [], liveMarketMemory: {}, orderRiskReservations: {},
    positionProtection: { ok: true }, liveTradeLimitState: { dateKey: 'TEST', positionIntents: {}, intradayStockEntriesToday: 0 },
    liveQuoteCache: {
      [SYMBOL]: { symbol: SYMBOL, price: 100, current: 100, bid: 99.95, ask: 100.05, spreadAvailable: true, spreadPercent: 0.1,
        liveQuoteSource: 'alpaca_crypto_latest', source: 'alpaca_crypto_latest', spreadSource: 'alpaca_crypto_latest',
        priceIsLive: quoteAgeMs <= 4000, liveQuoteUpdatedAt: stamp, spreadUpdatedAt: stamp, bidAskUpdatedAt: stamp, updatedAt: stamp },
    },
  };
  const calls = { getAsset: 0, orderbooks: 0, quotes: 0, posts: [], reserved: [] };
  const bookAt = freshBook === 'quiet' ? stamp : null; // null: stamped when served (newer than the quote)
  const top = BOOK_TOPS[freshBook === 'moved' ? 'moved' : 'same'];
  // Alpaca market data, through the real adapter (normalization, ordering).
  const dataRequest = async (route) => {
    const url = new URL(route, 'https://alpaca.invalid');
    if (url.pathname === '/v1beta3/crypto/us/latest/orderbooks') {
      calls.orderbooks += 1;
      return { orderbooks: { [SYMBOL]: { t: bookAt ?? iso(Date.now()), a: [{ p: top.ask, s: 10000 }], b: [{ p: top.bid, s: 10000 }] } } };
    }
    if (url.pathname === '/v1beta3/crypto/us/latest/quotes') {
      calls.quotes += 1; // Alpaca's latest quote is still the quiet one.
      return { quotes: { [SYMBOL]: { bp: 99.95, ap: 100.05, t: stamp } } };
    }
    throw new Error(`unexpected market-data request ${route}`);
  };
  const normalizeSymbol = (value) => String(value || '').trim().toUpperCase();
  const deps = {
    // server.js module-level state and configuration
    engineState, CONFIG, emergencyStopActive: false, autoTradingEnabled: true,
    LIVE_ORDER_REQUIRE_POLYGON_CONNECTED: true, LIVE_ORDER_MAX_QUOTE_AGE_SECONDS: 5, LIVE_ORDER_MAX_SPREAD_PERCENT: 1,
    LIVE_TRADE_LIMITS: { maxIntradayStockTradesPerDay: 2, maxIntradayStockPositions: 2, maxMultiDayStockPositions: 3, maxCryptoOpenPositions: 3 },
    CRYPTO_MAX_ENTRY_SPREAD_PERCENT,
    // the same real modules server.js imports
    normalizeSymbol, isCrypto: (value) => normalizeSymbol(value).includes('/'),
    purchasePolicy, isDiscretionaryManualPurchase, executionEvidenceIssues, researchExecutionIssues, assertVerifiedQuote,
    evaluateScaleInEvidence, riskPolicyVersion, assertRiskPolicyVersion, authorizationFingerprint, assertAuthorizationUnchanged,
    evaluateCryptoTradePlan, calculateLossBudgetSizing, assertPreTradeRisk, evaluateLiveTradeLimits, ensureLiveTradeLimitDay,
    outstandingOrderNotional, dedupeSignalsByCanonicalAuthority, getApprovedTradeAmount, evaluateCryptoTradeCandidate,
    evaluateStockTradeCandidate, revalidateCandidate, isAlpacaCryptoExecutionSource, evaluateLiveQuoteProviderReadiness,
    getLiveQuoteTimestampMs, getSpreadAgeSeconds, isFreshLiveQuoteHelper, isFreshMeasuredSpread, isLiveQuoteSource,
    assessCryptoQuoteSupersession, cryptoPriceLiveOrVerified, cryptoQuoteTop, cryptoReferenceCovers,
    effectiveCryptoEvidenceAgeMs, referenceTimeMs, verifyCryptoSignalAgainstReference, buildCryptoLimitBuyOrder,
    // the real resolver; only its 2 s retry wait is skipped
    resolvePreTradeQuote: (options) => resolvePreTradeQuote({ ...options, sleep: async () => {} }),
    alpacaCryptoMarketData: createAlpacaCryptoMarketData({ dataRequest, normalizeSymbol }),
    updateQuoteCache: (symbol, quote) => { engineState.liveQuoteCache[symbol] = quote; return quote; },
    // network / broker boundaries
    coinbaseReferenceStream: { getReference: (symbol) => {
      const value = typeof reference === 'function' ? reference(Date.now()) : reference;
      return value && normalizeSymbol(value.symbol) === normalizeSymbol(symbol) ? { ...value } : null;
    } },
    getAsset: async (symbol) => { calls.getAsset += 1; return { ...TEST_CRYPTO_ASSET, symbol }; },
    getAccount: async () => ({ equity: 1000, cash: 1000, buying_power: 1000, last_equity: 1000, snapshotAt: Date.now() }),
    getPositions: async () => Object.assign([], { stale: false, snapshotAt: Date.now() }),
    getBotOwnedSymbols: async () => new Set(),
    getClock: async () => { throw new Error('crypto must not depend on the stock clock'); },
    isAiManagedOpenPosition: () => true,
    orderRiskReservations: { reconcile: async () => 0, consumed: () => 0 },
    managedExecution: { assertReady() {} },
    getTodayKeyET: () => 'TEST',
  };
  const server = loadServerGuard(deps);
  const decision = canonicalDecision(at, quoteAgeMs, server.currentRiskPolicyVersion());
  engineState.lastCryptoSignals = [decision];
  const service = createOrderService({
    normalizeSymbol, isCrypto: deps.isCrypto, preTradeRiskGuard: server.preTradeRiskGuard,
    reserveRisk: async (payload, options) => {
      calls.reserved.push({ notional: payload.notional, riskNotional: options.riskNotional,
        riskReferencePrice: options.riskReferencePrice });
      if (reserveDelayMs) await sleep(reserveDelayMs);
      return { settle: async () => {} };
    },
    tradingRequest: async (route, request) => {
      const payload = JSON.parse(request.body);
      calls.posts.push(payload);
      return { id: `STUB-${calls.posts.length}`, status: 'pending_new', ...payload };
    },
  });
  const buy = () => service.cryptoMarketBuy({ symbol: SYMBOL, dollars: APPROVED_NOTIONAL });
  return { buy, calls, server, engineState };
}

test('production guard: a quiet 30 s-old Alpaca quote with a fresh close reference becomes a capped IOC limit buy', async () => {
  const { buy, calls } = buildScenario();
  const order = await buy();
  assert.equal(calls.posts.length, 1);
  const [payload] = calls.posts;
  assert.equal(payload.symbol, SYMBOL);
  assert.equal(payload.side, 'buy');
  assert.equal(payload.type, 'limit');
  assert.equal(payload.time_in_force, 'ioc');
  assert.equal('notional' in payload, false, 'a limit order never carries notional');
  const ask = 100.05;
  const limit = Number(payload.limit_price);
  assert.ok(limit >= ask && limit <= ask * 1.005, `limit ${limit} within [ask, ask * 1.005]`);
  assert.equal(payload.limit_price, floorToIncrement(ask * 1.005, TEST_CRYPTO_ASSET.price_increment).text);
  // Quantity rounded down to Alpaca's min_trade_increment.
  assert.equal(payload.qty, floorToIncrement(APPROVED_NOTIONAL / limit, TEST_CRYPTO_ASSET.min_trade_increment).text);
  assert.ok(Number(payload.qty) * limit <= APPROVED_NOTIONAL + 1e-9);
  // The risk reservation holds the worst-case spend, never above the approval.
  const [reservation] = calls.reserved;
  assert.ok(reservation.riskNotional <= APPROVED_NOTIONAL, String(reservation.riskNotional));
  assert.ok(Math.abs(reservation.riskNotional - Number(payload.qty) * limit) < 1e-6);
  assert.equal(reservation.riskReferencePrice, limit);
  assert.ok(calls.orderbooks >= 1, 'the guard re-read the Alpaca order book');
  assert.ok(calls.getAsset >= 1, 'increments came from the Alpaca asset');
  assert.equal(order.id, 'STUB-1');
});

test('production guard: a newer fresh book with the same top does not supersede the quiet quote', async () => {
  const { buy, calls } = buildScenario({ freshBook: 'newerSame' });
  await buy();
  assert.equal(calls.posts.length, 1);
});

const rejections = [
  ['no reference trade', { reference: null }, /QUOTE_VERIFICATION_FAILED/],
  ['a 6 s-old reference trade', { reference: (now) => ({ symbol: SYMBOL, price: 100.01, tradeAt: now - 6000, receivedAt: now - 100 }) },
    /QUOTE_VERIFICATION_FAILED/],
  ['a reference 0.5% from the Alpaca mid', { reference: (now) => ({ symbol: SYMBOL, price: 100.5, tradeAt: now - 500, receivedAt: now - 400 }) },
    /QUOTE_VERIFICATION_FAILED/],
  ['a superseded quote (the fresh Alpaca book is newer with a different top)', { freshBook: 'moved' }, /ALPACA_QUOTE_SUPERSEDED/],
  ['a 61 s-old Alpaca quote', { quoteAgeMs: 61000 }, /QUOTE_VERIFICATION_FAILED/],
];
for (const [name, options, reason] of rejections) {
  test(`production guard rejects ${name}; nothing is submitted`, async () => {
    const { buy, calls } = buildScenario(options);
    await assert.rejects(buy(), reason);
    assert.equal(calls.posts.length, 0);
    assert.equal(calls.reserved.length, 0, 'rejected by the guard itself, before any reservation');
  });
}

test('final check (assertCurrent): a quote that comes to rely on the reference is rejected when the fresh book supersedes it', async () => {
  // 2.5 s old at the guard (current by provider time, no reference needed);
  // older than 5 s at the final check, where it rests on the reference.
  const { buy, calls } = buildScenario({ quoteAgeMs: 2500, freshBook: 'moved', reserveDelayMs: 2800 });
  await assert.rejects(buy(), /ALPACA_QUOTE_SUPERSEDED/);
  assert.equal(calls.reserved.length, 1, 'the guard approved; the final check rejected');
  assert.equal(calls.posts.length, 0);
});

test('final check (assertCurrent): the same top in a newer book still passes once the quote relies on the reference', async () => {
  const { buy, calls } = buildScenario({ quoteAgeMs: 2500, freshBook: 'newerSame', reserveDelayMs: 2800 });
  await buy();
  assert.equal(calls.posts.length, 1);
});
