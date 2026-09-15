import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { calculateCryptoLiquidityFromBars } from '../scoring/cryptoScoring.js';
import { completedCryptoBars } from '../scoring/cryptoSetup.js';
import { normalizeCryptoVolume } from '../market-data/normalizeCryptoVolume.js';
import { isFreshLiveQuote } from '../live/liveQuoteCache.js';

test('receipt timestamps alone never establish executable price freshness', () => {
  const now = new Date().toISOString();
  const base = { source: 'alpaca_crypto_ws', priceIsLive: true, price: 100 };
  assert.equal(isFreshLiveQuote({ ...base, updatedAt: now, quoteFetchedAt: now }), false);
  assert.equal(isFreshLiveQuote({ ...base, liveQuoteUpdatedAt: new Date(Date.now() - 60000).toISOString(), updatedAt: now }), false);
});

test('zero volume stays zero; conflicting aliases cannot become positive evidence', () => {
  assert.deepEqual(normalizeCryptoVolume({ v: 0, volume: 0 }), { volume: 0, quoteVolume: undefined });
  assert.equal(normalizeCryptoVolume({ v: 0, volume: 100 }), null);
  const result = calculateCryptoLiquidityFromBars([{ c: 10, v: 0, volume: 100 }]);
  assert.equal(result.barEvidenceAvailable, false);
  assert.equal(result.windowDollarVolume, 0);
  assert.deepEqual(completedCryptoBars([{ c: 10, v: 0, volume: 100 }]), []);
});
test('malformed bar collections and entries produce unavailable evidence without crashing', () => {
  for (const bars of [null, {}, 'bars', [null], [undefined], [42], [{ c: 10, v: -1 }]]) {
    const result = calculateCryptoLiquidityFromBars(bars);
    assert.equal(result.barEvidenceAvailable, false);
    assert.equal(result.windowDollarVolume, 0);
    assert.deepEqual(completedCryptoBars(bars), []);
  }
});
test('latest zero volume is not replaced with historic positive volume', () => {
  const result = calculateCryptoLiquidityFromBars([{ c: 10, v: 100 }, { c: 10, v: 0 }]);
  assert.equal(result.volume, 0);
  assert.equal(result.effectiveVolume, 0);
  assert.equal(result.windowDollarVolume, 1000);
});
test('shared production buy guard explicitly rejects failed verification before score checks and rechecks at submission', () => {
  const source = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  const guard = source.slice(source.indexOf('const preTradeRiskGuard ='), source.indexOf('let protectionOwnershipOrders'));
  const verification = guard.indexOf('assertVerifiedQuote(quoteResolution, symbol)');
  assert.ok(verification >= 0 && verification < guard.indexOf('let sizingSignal'));
  assert.match(guard, /assertCurrent\(\)\s*\{\s*if \(!isPreTradeQuoteReady\(quote, cryptoAsset\)\)/);
});
