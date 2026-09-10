import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createTradierQuoteStream } from '../providers/tradierQuoteStream.js';
import { canRefreshStockQuotes } from '../market-data/stockQuoteSessionPolicy.js';

function fixture() {
  let now = Date.now(), requests = 0;
  const sockets = [], quotes = [];
  class Socket extends EventEmitter {
    constructor(url, options) { super(); this.readyState = 0; this.sent = []; sockets.push(this);
      assert.equal(url, 'wss://ws.tradier.com/v1/markets/events'); assert.equal(options.maxPayload, 65536); }
    send(value) { this.sent.push(JSON.parse(value)); }
    terminate() { this.readyState = 3; this.emit('close'); }
    open() { this.readyState = 1; this.emit('open'); }
    quote(overrides = {}) { this.emit('message', Buffer.from(JSON.stringify({ type: 'quote', symbol: 'AAPL',
      bid: 99.9, ask: 100.1, biddate: now - 1000, askdate: now - 500, ...overrides }))); }
  }
  const stream = createTradierQuoteStream({ apiKey: 'private-test-key', WebSocketImpl: Socket,
    now: () => now, onQuote: q => quotes.push(q), fetchImpl: async (url, options) => {
      requests++; assert.equal(options.method, 'POST'); assert.ok(!url.includes('private-test-key'));
      return new Response(JSON.stringify({ stream: { sessionid: 'private-session' } }));
    } });
  return { stream, sockets, quotes, advance: ms => { now += ms; }, requests: () => requests };
}
test('subscribes only stocks, uses independent provider bid/ask clocks, never receipt time', async () => {
  const f = fixture(); await f.stream.refresh(['AAPL', 'BTC/USD']); f.sockets[0].open();
  assert.deepEqual(f.sockets[0].sent[0].symbols, ['AAPL']);
  assert.deepEqual(f.sockets[0].sent[0].filter, ['quote']);
  f.sockets[0].quote(); assert.equal(f.quotes.length, 1);
  assert.equal(f.quotes[0].spreadUpdatedAt, f.quotes[0].bidUpdatedAt);
  assert.notEqual(f.quotes[0].spreadUpdatedAt, f.quotes[0].receivedAt);
  f.sockets[0].quote({ biddate: undefined }); assert.equal(f.quotes.length, 1);
  f.sockets[0].quote({ bid: 101 }); assert.equal(f.quotes.length, 1);
  f.sockets[0].quote({ type: 'trade' }); assert.equal(f.quotes.length, 1);
  f.sockets[0].quote({ biddate: Date.now() + 60000 }); assert.equal(f.quotes.length, 1);
  assert.ok(!JSON.stringify(f.stream.getStatus()).includes('private-'));
  f.stream.stop();
});
test('coalesces sessions, resubscribes, backs off disconnects and ignores old sockets', async () => {
  const f = fixture(); await Promise.all([f.stream.refresh(['AAPL']), f.stream.refresh(['AAPL'])]);
  assert.equal(f.requests(), 1); const old = f.sockets[0]; old.open();
  await f.stream.refresh(['AAPL', 'MSFT']); assert.equal(old.sent.length, 2);
  old.emit('error', new Error('disconnect')); await f.stream.refresh(['AAPL']); assert.equal(f.requests(), 1);
  f.advance(60001); await f.stream.refresh(['AAPL']); assert.equal(f.requests(), 2);
  f.sockets[1].open(); old.quote(); assert.equal(f.quotes.length, 0);
  f.sockets[1].quote(); assert.equal(f.quotes.length, 1);
  await f.stream.refresh([]); assert.equal(f.stream.getStatus().connected, false);
  f.stream.stop(); await f.stream.refresh(['AAPL']); assert.equal(f.requests(), 2);
});
test('missing credentials and sandbox never open production sessions', async () => {
  for (const config of [{}, { apiKey: 'test', sandbox: true }, { apiKey: 'test', enabled: false }]) {
    const stream = createTradierQuoteStream({ ...config, fetchImpl: () => assert.fail('unexpected request') });
    await stream.refresh(['AAPL']); assert.equal(stream.getStatus().connected, false);
  }
});

test('market close keeps research subscriptions until the after-hours session ends', async () => {
  const f = fixture();
  const refresh = (marketOpen, marketSession) => f.stream.refresh(
    canRefreshStockQuotes({ marketOpen, marketSession }) ? ['AAPL', 'MSFT'] : []);
  await refresh(true, 'regular'); f.sockets[0].open();
  await refresh(false, 'afterhours');
  assert.equal(f.stream.getStatus().connected, true);
  assert.equal(f.stream.getStatus().subscribedCount, 2);
  assert.equal(f.requests(), 1);
  f.sockets[0].quote(); assert.equal(f.quotes.length, 1);
  await refresh(false, 'closed');
  assert.equal(f.stream.getStatus().connected, false);
  assert.equal(f.stream.getStatus().subscribedCount, 0);
  f.stream.stop();
});
