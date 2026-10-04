import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CRYPTO_REFERENCE_POLICY,
  assessCryptoQuoteSupersession,
  cryptoBookTop,
  cryptoPriceLiveOrVerified,
  cryptoQuoteTop,
  cryptoReferenceCovers,
  effectiveCryptoEvidenceAgeMs,
  effectiveCryptoEvidenceAtMs,
  verifyCryptoQuoteCurrent,
  verifyCryptoSignalAgainstReference,
} from '../scoring/cryptoReferenceVerification.js';

const now = Date.parse('2026-10-03T12:00:00.000Z');
const quoteAt = now - 30000; // a quiet Alpaca quote, unchanged for 30 s
const bookAt = now - 30000;
const reference = (patch = {}) => ({ symbol: 'BTC/USD', price: 100.02, tradeAt: now - 1200, receivedAt: now - 1100, ...patch });
const input = (patch = {}) => ({ symbol: 'BTC/USD', bid: 99.95, ask: 100.05, quoteProviderAtMs: quoteAt,
  spreadProviderAtMs: quoteAt, bookProviderAtMs: bookAt, bookBid: 99.95, bookAsk: 100.05, reference: reference(), now, ...patch });
// Coverage checks pass back the values they check (the quote's bid/ask).
const QUOTE = { bid: 99.95, ask: 100.05 };

test('fresh reference close to the Alpaca mid verifies the quiet quote and book', () => {
  const result = verifyCryptoQuoteCurrent(input());
  assert.equal(result.verified, true, result.reasons.join());
  assert.deepEqual(result.reasons, []);
  assert.equal(result.verifiedAtMs, now - 1200, 'verifiedAt = min(reference trade time, now)');
  assert.equal(result.referencePrice, 100.02);
  assert.equal(result.referenceAgeMs, 1200);
  assert.equal(result.alpacaMid, 100);
  assert.ok(Math.abs(result.deviationPct - 0.02) < 1e-9);
  assert.deepEqual(result.coveredProviderAtMs, [quoteAt, quoteAt, bookAt]);
  assert.deepEqual(result.coveredEvidence, [
    { kind: 'quote', at: quoteAt, bid: 99.95, ask: 100.05 },
    { kind: 'spread', at: quoteAt, bid: 99.95, ask: 100.05 },
    { kind: 'book', at: bookAt, bid: 99.95, ask: 100.05 },
  ]);
  assert.equal(result.version, CRYPTO_REFERENCE_POLICY.version);
});

test('verification truth table fails closed on every missing, stale, future, distant or invalid input', () => {
  const cases = [
    ['missing reference', { reference: null }, 'REFERENCE_MISSING'],
    ['reference trade 5.001 s old', { reference: reference({ tradeAt: now - 5001 }) }, 'REFERENCE_STALE'],
    ['reference trade 6 s old', { reference: reference({ tradeAt: now - 6000, receivedAt: now - 100 }) }, 'REFERENCE_STALE'],
    ['reference received 6 s ago', { reference: reference({ receivedAt: now - 6000 }) }, 'REFERENCE_RECEIPT_STALE'],
    ['reference trade in the future', { reference: reference({ tradeAt: now + 1500 }) }, 'REFERENCE_TIME_FUTURE'],
    ['reference receipt in the future', { reference: reference({ receivedAt: now + 1500 }) }, 'REFERENCE_RECEIPT_TIME_FUTURE'],
    ['reference time invalid', { reference: reference({ tradeAt: 'nope' }) }, 'REFERENCE_TIME_INVALID'],
    ['reference price zero', { reference: reference({ price: 0 }) }, 'REFERENCE_PRICE_INVALID'],
    ['reference symbol mismatch', { reference: reference({ symbol: 'ETH/USD' }) }, 'REFERENCE_SYMBOL_MISMATCH'],
    ['deviation 0.5%', { reference: reference({ price: 100.5 }) }, 'REFERENCE_DEVIATION_EXCEEDED'],
    ['deviation 0.31% below', { reference: reference({ price: 99.69 }) }, 'REFERENCE_DEVIATION_EXCEEDED'],
    ['Alpaca quote 61 s old', { quoteProviderAtMs: now - 61000 }, 'ALPACA_QUOTE_TOO_OLD'],
    ['Alpaca spread 61 s old', { spreadProviderAtMs: now - 61000 }, 'ALPACA_SPREAD_TOO_OLD'],
    ['Alpaca book 61 s old', { bookProviderAtMs: now - 61000 }, 'ALPACA_BOOK_TOO_OLD'],
    ['Alpaca quote in the future', { quoteProviderAtMs: now + 2000 }, 'ALPACA_QUOTE_TIME_FUTURE'],
    ['Alpaca quote time missing', { quoteProviderAtMs: null }, 'ALPACA_QUOTE_TIME_INVALID'],
    ['Alpaca book time invalid', { bookProviderAtMs: NaN }, 'ALPACA_BOOK_TIME_INVALID'],
    ['bid above ask', { bid: 100.1, ask: 100 }, 'ALPACA_BID_ASK_INVALID'],
    ['zero bid', { bid: 0 }, 'ALPACA_BID_ASK_INVALID'],
    ['missing ask', { ask: undefined }, 'ALPACA_BID_ASK_INVALID'],
    ['invalid now', { now: NaN }, 'NOW_INVALID'],
  ];
  for (const [name, patch, reason] of cases) {
    const result = verifyCryptoQuoteCurrent(input(patch));
    assert.equal(result.verified, false, name);
    assert.equal(result.verifiedAtMs, null, name);
    assert.deepEqual(result.coveredProviderAtMs, [], name);
    assert.deepEqual(result.coveredEvidence, [], name);
    assert.ok(result.reasons.includes(reason), `${name}: ${result.reasons.join()}`);
  }
});

test('boundaries: 5 s reference, 0.3% deviation, 60 s Alpaca age and a sub-second future trade still verify', () => {
  assert.equal(verifyCryptoQuoteCurrent(input({ reference: reference({ tradeAt: now - 5000, receivedAt: now - 5000 }) })).verified, true);
  assert.equal(verifyCryptoQuoteCurrent(input({ reference: reference({ price: 100.29 }) })).verified, true);
  assert.equal(verifyCryptoQuoteCurrent(input({ quoteProviderAtMs: now - 60000, spreadProviderAtMs: now - 60000, bookProviderAtMs: now - 60000 })).verified, true);
  const future = verifyCryptoQuoteCurrent(input({ reference: reference({ tradeAt: now + 800, receivedAt: now }) }));
  assert.equal(future.verified, true);
  assert.equal(future.verifiedAtMs, now, 'a reference time ahead of the clock is capped at now');
  const noBook = verifyCryptoQuoteCurrent(input({ bookProviderAtMs: undefined }));
  assert.equal(noBook.verified, true, 'a book is checked only when one is involved');
  assert.deepEqual(noBook.coveredProviderAtMs, [quoteAt, quoteAt]);
});

test('effective age uses verification only for the exact covered provider timestamp within its windows', () => {
  const verification = verifyCryptoQuoteCurrent(input());
  assert.equal(effectiveCryptoEvidenceAgeMs({ providerAtMs: quoteAt, verification, now, ...QUOTE }), 1200);
  assert.equal(effectiveCryptoEvidenceAtMs({ providerAtMs: quoteAt, verification, now, ...QUOTE }), now - 1200);
  assert.equal(effectiveCryptoEvidenceAgeMs({ providerAtMs: new Date(quoteAt).toISOString(), verification, now, ...QUOTE }), 1200);
  // A different (uncovered) Alpaca timestamp keeps its provider age.
  assert.equal(effectiveCryptoEvidenceAgeMs({ providerAtMs: quoteAt - 1, verification, now, ...QUOTE }), 30001);
  // Verification older than 5 s no longer counts.
  assert.equal(effectiveCryptoEvidenceAgeMs({ providerAtMs: quoteAt, verification, now: now + 3801, ...QUOTE }), 33801);
  // Provider evidence beyond 60 s is never rescued.
  assert.equal(effectiveCryptoEvidenceAgeMs({ providerAtMs: quoteAt, verification, now: now + 30001, ...QUOTE }), 60001);
  // Unverified, missing, wrong symbol, wrong version: provider age.
  const failed = verifyCryptoQuoteCurrent(input({ reference: reference({ price: 101 }) }));
  assert.equal(effectiveCryptoEvidenceAgeMs({ providerAtMs: quoteAt, verification: failed, now, ...QUOTE }), 30000);
  assert.equal(effectiveCryptoEvidenceAgeMs({ providerAtMs: quoteAt, verification: null, now, ...QUOTE }), 30000);
  assert.equal(effectiveCryptoEvidenceAgeMs({ providerAtMs: quoteAt, verification, now, symbol: 'ETH/USD', ...QUOTE }), 30000);
  assert.equal(effectiveCryptoEvidenceAgeMs({ providerAtMs: quoteAt, verification: { ...verification, version: 'OLD' }, now, ...QUOTE }), 30000);
  assert.equal(effectiveCryptoEvidenceAgeMs({ providerAtMs: null, verification, now, ...QUOTE }), null);
  assert.equal(cryptoReferenceCovers({ providerAtMs: quoteAt, verification, now, symbol: 'BTCUSD', ...QUOTE }), true);
});

test('coverage is bound to the checked bid/ask (or book top), not only to the provider millisecond', () => {
  const verification = verifyCryptoQuoteCurrent(input());
  const covers = (patch) => cryptoReferenceCovers({ providerAtMs: quoteAt, verification, now, symbol: 'BTC/USD', ...QUOTE, ...patch });
  assert.equal(covers({}), true);
  assert.equal(covers({ kind: 'quote' }), true);
  assert.equal(covers({ kind: 'spread' }), true);
  // Same timestamp, different values: a different quote, never covered.
  assert.equal(covers({ bid: 99.94 }), false);
  assert.equal(covers({ ask: 100.06 }), false);
  // Callers that do not say what they check are never covered.
  assert.equal(covers({ bid: null, ask: null }), false);
  assert.equal(covers({ bid: undefined }), false);
  assert.equal(effectiveCryptoEvidenceAgeMs({ providerAtMs: quoteAt, verification, now }), 30000);
  // The book entry is bound to the book's top, with its own kind.
  assert.equal(covers({ providerAtMs: bookAt, kind: 'book' }), true);
  assert.equal(covers({ providerAtMs: bookAt, kind: 'book', bid: 99.9 }), false);
  const otherBookTop = verifyCryptoQuoteCurrent(input({ bookProviderAtMs: quoteAt - 5000, bookBid: 99.9, bookAsk: 100.1 }));
  assert.equal(cryptoReferenceCovers({ providerAtMs: quoteAt - 5000, verification: otherBookTop, now, kind: 'book', ...QUOTE }), false);
  assert.equal(cryptoReferenceCovers({ providerAtMs: quoteAt - 5000, verification: otherBookTop, now, kind: 'book', bid: 99.9, ask: 100.1 }), true);
  // A book without a valid top (empty, crossed) is never covered; the quote still is.
  const noTop = verifyCryptoQuoteCurrent(input({ bookBid: null, bookAsk: null }));
  assert.equal(noTop.verified, true);
  assert.deepEqual(noTop.coveredEvidence.map((entry) => entry.kind), ['quote', 'spread']);
  // A forged record without value-bound evidence covers nothing.
  assert.equal(cryptoReferenceCovers({ providerAtMs: quoteAt, verification: { ...verification, coveredEvidence: undefined }, now, ...QUOTE }), false);
});

test('effective age is never larger than the provider age (covered provider time newer than verifiedAt)', () => {
  // A genuinely fresh Alpaca quote (0.5 s old) verified by a 3 s-old reference trade.
  const freshAt = now - 500;
  const verification = verifyCryptoQuoteCurrent(input({ quoteProviderAtMs: freshAt, spreadProviderAtMs: freshAt,
    bookProviderAtMs: freshAt, reference: reference({ tradeAt: now - 3000, receivedAt: now - 2900 }) }));
  assert.equal(verification.verified, true);
  assert.equal(verification.verifiedAtMs, now - 3000);
  assert.equal(effectiveCryptoEvidenceAgeMs({ providerAtMs: freshAt, verification, now, ...QUOTE }), 500);
  assert.equal(effectiveCryptoEvidenceAtMs({ providerAtMs: freshAt, verification, now, ...QUOTE }), freshAt);
  assert.equal(effectiveCryptoEvidenceAgeMs({ providerAtMs: freshAt, verification, now, kind: 'book', ...QUOTE }), 500);
  // An older (quiet) covered quote still uses the time since verification.
  const quiet = verifyCryptoQuoteCurrent(input({ reference: reference({ tradeAt: now - 3000, receivedAt: now - 2900 }) }));
  assert.equal(effectiveCryptoEvidenceAgeMs({ providerAtMs: quoteAt, verification: quiet, now, ...QUOTE }), 3000);
});

test('book and quote tops are read the way the verifier reads them', () => {
  assert.deepEqual(cryptoQuoteTop({ bp: 1, ap: 2 }), { bid: 1, ask: 2 });
  assert.deepEqual(cryptoQuoteTop({ bid: '0', bp: 1, ask: 3 }), { bid: 1, ask: 3 });
  assert.deepEqual(cryptoBookTop({ bids: [{ p: 99, s: 1 }, { p: 99.5, s: 0 }, { p: 99.2, s: 2 }],
    asks: [{ p: 101, s: 1 }, { p: 100.5, s: 3 }] }), { bid: 99.2, ask: 100.5 });
  assert.deepEqual(cryptoBookTop({ bids: [{ p: 101, s: 1 }], asks: [{ p: 100, s: 1 }] }), { bid: null, ask: null });
  assert.deepEqual(cryptoBookTop(null), { bid: null, ask: null });
});

test('a fresh Alpaca book supersedes a cached quote unless it is not newer or has the same top', () => {
  const quote = { bid: 99.95, ask: 100.05, spreadUpdatedAt: new Date(quoteAt).toISOString() };
  const book = (patch = {}) => ({ symbol: 'BTC/USD', updatedAt: new Date(now).toISOString(),
    bids: [{ p: 99.95, s: 1 }], asks: [{ p: 100.05, s: 1 }], ...patch });
  const check = (b, priceIncrement = '0.01', q = quote) => assessCryptoQuoteSupersession({ quote: q, book: b, priceIncrement });
  // Not newer than the quote's bid/ask provider time: never superseded.
  assert.equal(check(book({ updatedAt: new Date(quoteAt).toISOString(), bids: [{ p: 90, s: 1 }] })).superseded, false);
  assert.equal(check(book({ updatedAt: new Date(quoteAt - 1000).toISOString(), bids: [{ p: 90, s: 1 }] })).superseded, false);
  // Newer with the same top (exactly, or within one price increment).
  assert.equal(check(book()).superseded, false);
  assert.equal(check(book({ bids: [{ p: 99.96, s: 1 }], asks: [{ p: 100.04, s: 1 }] })).superseded, false);
  // Newer with a different top: Alpaca has moved on.
  const moved = check(book({ bids: [{ p: 100.00, s: 1 }], asks: [{ p: 100.10, s: 1 }] }));
  assert.equal(moved.superseded, true);
  assert.equal(moved.reason, 'FRESH_ALPACA_BOOK_TOP_DIFFERS');
  assert.equal(check(book({ asks: [{ p: 100.07, s: 1 }] })).superseded, true, 'ask two increments away');
  // Fail closed on anything missing.
  assert.equal(check(null).reason, 'FRESH_ALPACA_BOOK_UNAVAILABLE');
  assert.equal(check(book(), null).reason, 'PRICE_INCREMENT_UNAVAILABLE');
  assert.equal(check(book({ bids: [] })).reason, 'FRESH_ALPACA_BOOK_TOP_INVALID');
  assert.equal(check(book(), '0.01', { ...quote, bid: 0 }).reason, 'QUOTE_BID_ASK_INVALID');
  assert.equal(check(book({ updatedAt: 'x', asks: [{ p: 101, s: 1 }] })).reason, 'FRESH_ALPACA_BOOK_TIME_INVALID');
  assert.equal(check(book({ asks: [{ p: 101, s: 1 }] }), '0.01', { ...quote, spreadUpdatedAt: null }).superseded, true,
    'without a quote bid/ask time only an equal top proves the quote is current');
});

test('signal extraction never mutates the signal and binds the attached book', () => {
  const signal = Object.freeze({ symbol: 'BTC/USD', bid: 99.95, ask: 100.05, priceIsLive: false,
    liveQuoteUpdatedAt: new Date(quoteAt).toISOString(), spreadUpdatedAt: new Date(quoteAt).toISOString(),
    cryptoOrderbook: Object.freeze({ updatedAt: new Date(bookAt).toISOString() }) });
  const verification = verifyCryptoSignalAgainstReference(signal, reference(), { now });
  assert.equal(verification.verified, true);
  assert.equal(verification.bookProviderAtMs, bookAt);
  assert.equal(signal.liveQuoteUpdatedAt, new Date(quoteAt).toISOString());
  assert.equal(cryptoPriceLiveOrVerified({ ...signal, cryptoReferenceVerification: verification }, { now }), true);
  assert.equal(cryptoPriceLiveOrVerified(signal, { now }), false);
  const oldBook = verifyCryptoSignalAgainstReference({ ...signal, cryptoOrderbook: { updatedAt: new Date(now - 61000).toISOString() } }, reference(), { now });
  assert.equal(oldBook.verified, false);
  assert.ok(oldBook.reasons.includes('ALPACA_BOOK_TOO_OLD'));
  const withoutBook = verifyCryptoSignalAgainstReference({ ...signal, cryptoOrderbook: { updatedAt: 'x' } }, reference(), { now, includeBook: false });
  assert.equal(withoutBook.verified, true);
});

test('a book that does not describe the verified market keeps its own provider age', () => {
  const superseded = verifyCryptoQuoteCurrent(input({ bookBid: 50, bookAsk: 51, bookProviderAtMs: now - 59000 }));
  assert.equal(superseded.verified, true, 'the quote itself is still verified');
  assert.equal(cryptoReferenceCovers({ providerAtMs: now - 59000, verification: superseded, now, symbol: 'BTC/USD', bid: 50, ask: 51, kind: 'book' }), false);
  assert.equal(effectiveCryptoEvidenceAgeMs({ providerAtMs: now - 59000, verification: superseded, now, symbol: 'BTC/USD', bid: 50, ask: 51, kind: 'book' }), 59000);
  // A book 0.5% away from the quote ask is not covered either; a matching one is.
  const drifted = verifyCryptoQuoteCurrent(input({ bookBid: 100.4, bookAsk: 100.55 }));
  assert.equal(cryptoReferenceCovers({ providerAtMs: bookAt, verification: drifted, now, symbol: 'BTC/USD', bid: 100.4, ask: 100.55, kind: 'book' }), false);
  const matching = verifyCryptoQuoteCurrent(input());
  assert.equal(cryptoReferenceCovers({ providerAtMs: bookAt, verification: matching, now, symbol: 'BTC/USD', bid: 99.95, ask: 100.05, kind: 'book' }), true);
});

test('rotation never sells first on a reference-verified quiet quote', async () => {
  const fs = await import('node:fs');
  const source = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  const sellAt = source.indexOf('const sellOrder = await placeCryptoMarketSell(');
  const guardAt = source.lastIndexOf('CRYPTO_ROTATION_SKIPPED_QUOTE_NOT_PROVIDER_FRESH', sellAt);
  assert.ok(guardAt > 0 && sellAt - guardAt < 800, 'provider-fresh check sits right before the rotation sell');
  const check = source.slice(source.lastIndexOf('if (!cryptoQuoteHasFreshAlpacaBook(', guardAt), guardAt);
  assert.doesNotMatch(check, /verification/, 'the rotation check must not accept a reference verification');
});
