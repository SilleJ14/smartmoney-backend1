import test from 'node:test';
import assert from 'node:assert/strict';
import { createStockNewsReview } from '../market-data/stockNewsReview.js';

test('material news versions are stable across repeats and change on new evidence', async () => {
  let now = Date.now(), calls = 0; const events = [];
  let articles = [{headline:'Company announces merger agreement', datetime:now / 1000}];
  const reader = createStockNewsReview({ now: () => now, onEvidence: event => events.push(event),
    providers: { fixture: async () => { calls++; return articles; } } });
  await reader.get('AAPL'); await reader.get('AAPL');
  assert.equal(calls, 1); assert.ok(events[0].materialVersion);
  now += 60001; await reader.get('AAPL');
  assert.equal(events[1].materialVersion, events[0].materialVersion);
  articles = [...articles, {headline:'Company announces stock offering', datetime: now / 1000}];
  now += 60001; const result = await reader.get('AAPL');
  assert.notEqual(events[2].materialVersion, events[1].materialVersion);
  assert.equal(result.risk, true);
});
test('checked empty news is valid review, provider failure is not', async () => {
  const empty = createStockNewsReview({ providers: { finnhub: async () => [] } });
  const result = await empty.get('AAPL'); assert.equal(result.available, true); assert.match(result.reason, /no headlines/);
  const failed = createStockNewsReview({ providers: { finnhub: async () => { throw new Error('offline'); } } });
  assert.equal((await failed.get('AAPL')).available, false);
});
test('Alpaca fallback reviews adverse news and coalesces simultaneous requests', async () => {
  let calls = 0;
  const reader = createStockNewsReview({ providers: {
    finnhub: async () => { throw Object.assign(new Error('quota'), { status: 429 }); },
    alpaca: async () => { calls++; return [{ headline: 'Company announces stock offering', created_at: new Date().toISOString() }]; },
  } });
  const results = await Promise.all(Array.from({ length: 10 }, () => reader.get('AAPL')));
  assert.equal(calls, 1); assert.ok(results.every(r => r.available && r.risk));
  assert.equal(results[0].source, 'alpaca');
});
test('rejects malformed/future news and retries failed cache after bounded backoff', async () => {
  let time = Date.now(), invalid = true;
  const reader = createStockNewsReview({ now: () => time, providers: { news: async () => invalid
    ? [{ headline: 'future', datetime: (time + 100000) / 1000 }] : [] } });
  assert.equal((await reader.get('AAPL')).available, false);
  invalid = false; time += 15001;
  assert.equal((await reader.get('AAPL')).available, true);
});
