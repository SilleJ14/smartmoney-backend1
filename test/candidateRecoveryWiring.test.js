import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { canRefreshStockQuotes, getStockMoverQuotePolicy } from '../market-data/stockQuoteSessionPolicy.js';
import { createAlpacaClient } from '../execution/alpacaClient.js';

test('regular-session research stays subscribed during clock outage without execution permission', () => {
  assert.equal(canRefreshStockQuotes({ marketOpen: false, marketSession: 'regular_research' }), true);
  const policy = getStockMoverQuotePolicy({ marketOpen: false, marketSession: 'regular_research' });
  assert.equal(policy.discoveryOnly, true); assert.equal(policy.maxQuoteAgeSeconds, 5);
});
test('actual crypto refresh returns quotes without waiting for slow orderbook research', async () => {
  const source = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  const start = source.indexOf('async function refreshCryptoExecutionEvidence(symbols)');
  const end = source.indexOf('async function refreshActiveCandidateQuotes', start);
  assert.ok(start > 0 && end > start);
  let release, bookJob;
  const delayed = new Promise(resolve => { release = resolve; });
  const state = { lastCryptoSignals: [{ symbol: 'BTC/USD', cryptoSetup: { eligible: true } }] };
  const context = vm.createContext({ engineState: state,
    dedupeSignalsByCanonicalAuthority: rows => rows, getCanonicalFinalScore: () => 80,
    runLiveScheduledTask: (_name, _interval, work) => (bookJob = work()),
    alpacaCryptoMarketData: { getLatestOrderbooks: () => delayed, getLatestQuotes: async () => [{ symbol: 'BTC/USD', price: 100 }] },
  });
  vm.runInContext(source.slice(start, end), context);
  const quotes = await context.refreshCryptoExecutionEvidence(['BTC/USD']);
  assert.equal(quotes[0].price, 100);
  assert.equal(state.lastCryptoSignals[0].cryptoOrderbook, undefined);
  release([{ symbol: 'BTC/USD', updatedAt: 'provider-time' }]); await bookJob;
  assert.equal(state.lastCryptoSignals[0].cryptoOrderbook.updatedAt, 'provider-time');
});
test('Alpaca data errors retain status for bounded provider backoff', async () => {
  const client = createAlpacaClient({ getKeys: () => ({}), dataBaseUrl: 'https://fixture',
    fetchWithTimeout: async () => ({ ok: false, status: 429, text: async () => '{"message":"rate limited"}' }) });
  await assert.rejects(client.dataRequest('/v1beta1/news'), error => error.status === 429);
});
