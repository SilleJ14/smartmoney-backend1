import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  createCoinbaseReferenceStream,
  fromCoinbaseProduct,
  toCoinbaseProduct,
} from '../live/coinbaseReferenceStream.js';

// No network: a fake WebSocket records what the stream sends and lets the
// test emit open/message/close exactly like the 'ws' package does.
function harness({ symbols = ['BTC/USD', 'ETH/USD', 'AAPL'], maxProducts = 40 } = {}) {
  const sockets = [];
  class FakeSocket extends EventEmitter {
    constructor(url, options) { super(); this.url = url; this.options = options; this.sent = []; this.closed = false; sockets.push(this); }
    send(raw) { this.sent.push(JSON.parse(raw)); }
    close() { this.closed = true; }
  }
  const clock = { now: Date.parse('2026-10-03T12:00:00.000Z') };
  let tick = null;
  const statuses = [];
  const state = { symbols };
  const stream = createCoinbaseReferenceStream({
    WebSocket: FakeSocket,
    getSymbols: () => state.symbols,
    now: () => clock.now,
    setTimer: (fn) => { tick = fn; return { unref() {} }; },
    clearTimer: () => {},
    onStatus: (status) => statuses.push(status),
    maxProducts,
  });
  const message = (socket, body) => socket.emit('message', Buffer.from(JSON.stringify(body)));
  const iso = (ms) => new Date(ms).toISOString().replace('Z', '123Z'); // microsecond-style provider time
  return { stream, sockets, clock, state, statuses, message, iso, runTick: () => tick() };
}

test('product mapping round-trips Alpaca and Coinbase symbols and rejects non-USD or stock symbols', () => {
  assert.equal(toCoinbaseProduct('BTC/USD'), 'BTC-USD');
  assert.equal(toCoinbaseProduct('btcusd'), 'BTC-USD');
  assert.equal(toCoinbaseProduct('ETH-USD'), 'ETH-USD');
  assert.equal(toCoinbaseProduct('AAPL'), null);
  assert.equal(toCoinbaseProduct('BTC/EUR'), null);
  assert.equal(fromCoinbaseProduct('SOL-USD'), 'SOL/USD');
  assert.equal(fromCoinbaseProduct('SOL-EUR'), null);
});

test('subscribes matches and heartbeat for crypto candidates only, capped, and records provider trade time', () => {
  const h = harness({ symbols: ['BTC/USD', 'ETH/USD', 'AAPL', 'SOL/USD'], maxProducts: 2 });
  h.stream.start();
  assert.equal(h.sockets.length, 1);
  assert.equal(h.sockets[0].url, 'wss://ws-feed.exchange.coinbase.com');
  h.sockets[0].emit('open');
  assert.deepEqual(h.sockets[0].sent[0], { type: 'subscribe', product_ids: ['BTC-USD', 'ETH-USD'], channels: ['matches', 'heartbeat'] });
  h.message(h.sockets[0], { type: 'subscriptions', channels: [{ name: 'matches', product_ids: ['BTC-USD', 'ETH-USD'] },
    { name: 'heartbeat', product_ids: ['BTC-USD', 'ETH-USD'] }] });
  const tradeAt = h.clock.now - 800;
  h.clock.now += 5;
  h.message(h.sockets[0], { type: 'match', trade_id: 7, product_id: 'BTC-USD', price: '60123.45', size: '0.1', side: 'buy', time: h.iso(tradeAt) });
  const reference = h.stream.getReference('BTC/USD');
  assert.deepEqual(reference, { symbol: 'BTC/USD', product: 'BTC-USD', price: 60123.45, tradeAt: tradeAt + 0, receivedAt: h.clock.now,
    tradeId: 7, source: 'coinbase_exchange_matches' });
  reference.price = 1; // callers receive a copy
  assert.equal(h.stream.getReference('BTC/USD').price, 60123.45);
  assert.equal(h.stream.getReference('BTCUSD').price, 60123.45);
  assert.equal(h.stream.getReference('SOL/USD'), null);
  const status = h.stream.getStatus();
  assert.equal(status.connected, true);
  assert.equal(status.subscribedCount, 2);
  assert.deepEqual(status.subscribedProducts, ['BTC-USD', 'ETH-USD']);
  assert.equal(status.symbols['BTC/USD'].tradeAgeMs, 805);
  assert.equal(status.freshReferenceCount, 1);
  assert.equal(status.lastMessageAt, new Date(h.clock.now).toISOString());
});

test('rejects future, invalid and non-positive trades, unknown products, and never regresses to an older trade', () => {
  const h = harness();
  h.stream.start();
  h.sockets[0].emit('open');
  const s = h.sockets[0];
  const now = h.clock.now;
  h.message(s, { type: 'match', trade_id: 1, product_id: 'BTC-USD', price: '100', time: h.iso(now + 1500) });
  h.message(s, { type: 'match', trade_id: 2, product_id: 'BTC-USD', price: '100', time: 'not-a-time' });
  h.message(s, { type: 'match', trade_id: 3, product_id: 'BTC-USD', price: '0', time: h.iso(now - 100) });
  h.message(s, { type: 'match', trade_id: 4, product_id: 'BTC-USD', price: '-5', time: h.iso(now - 100) });
  h.message(s, { type: 'match', trade_id: 5, product_id: 'DOGE-USD', price: '0.1', time: h.iso(now - 100) });
  assert.equal(h.stream.getReference('BTC/USD'), null);
  assert.equal(h.stream.getReference('DOGE/USD'), null);
  assert.equal(h.stream.getStatus().rejectedMatches, 4);
  h.message(s, { type: 'last_match', trade_id: 9, product_id: 'BTC-USD', price: '101', time: h.iso(now - 200) });
  assert.equal(h.stream.getReference('BTC/USD').price, 101);
  h.message(s, { type: 'match', trade_id: 8, product_id: 'BTC-USD', price: '99', time: h.iso(now - 300) });
  assert.equal(h.stream.getReference('BTC/USD').price, 101, 'older trade must not replace a newer reference');
  h.message(s, { type: 'heartbeat', product_id: 'BTC-USD', last_trade_id: 9, time: h.iso(now) });
  assert.equal(h.stream.getReference('BTC/USD').price, 101, 'heartbeats prove liveness only');
  h.message(s, { type: 'match', trade_id: 10, product_id: 'BTC-USD', price: '102', time: h.iso(now - 50) });
  assert.equal(h.stream.getReference('BTC/USD').price, 102);
});

test('resubscribes when the candidate set changes and drops references for removed products', () => {
  const h = harness({ symbols: ['BTC/USD', 'ETH/USD'] });
  h.stream.start();
  const s = h.sockets[0];
  s.emit('open');
  h.message(s, { type: 'match', trade_id: 1, product_id: 'ETH-USD', price: '2500', time: h.iso(h.clock.now - 100) });
  assert.equal(h.stream.getReference('ETH/USD').price, 2500);
  h.state.symbols = ['BTC/USD', 'SOL/USD'];
  h.runTick();
  assert.deepEqual(s.sent.at(-2), { type: 'unsubscribe', product_ids: ['ETH-USD'], channels: ['matches', 'heartbeat'] });
  assert.deepEqual(s.sent.at(-1), { type: 'subscribe', product_ids: ['SOL-USD'], channels: ['matches', 'heartbeat'] });
  assert.equal(h.stream.getReference('ETH/USD'), null);
  const sentBefore = s.sent.length;
  h.runTick();
  assert.equal(s.sent.length, sentBefore, 'an unchanged set sends nothing');
});

test('an invalid product is excluded and the remaining products are requested again on the same socket', () => {
  const h = harness({ symbols: ['BTC/USD', 'NOPE/USD'] });
  h.stream.start();
  const s = h.sockets[0];
  s.emit('open');
  assert.deepEqual(s.sent[0].product_ids, ['BTC-USD', 'NOPE-USD']);
  h.message(s, { type: 'error', message: 'Failed to subscribe', reason: 'NOPE-USD is not a valid product' });
  h.runTick();
  assert.equal(h.sockets.length, 1, 'no reconnect for an unknown product');
  assert.deepEqual(s.sent.at(-1), { type: 'subscribe', product_ids: ['BTC-USD'], channels: ['matches', 'heartbeat'] });
  assert.deepEqual(h.stream.getStatus().rejectedProducts, ['NOPE-USD']);
});

test('any subscribe failure naming requested products excludes only those (for a while); one naming none reconnects', () => {
  const h = harness({ symbols: ['BTC/USD', 'ETH/USD', 'ZZZ/USD'] });
  h.stream.start();
  const s = h.sockets[0];
  s.emit('open');
  h.message(s, { type: 'subscriptions', channels: [{ name: 'matches', product_ids: ['BTC-USD'] }] });
  // A reason other than "not a valid product"; a confirmed product it names is kept.
  h.message(s, { type: 'error', message: 'Failed to subscribe', reason: 'ZZZ-USD is delisted (BTC-USD unaffected)' });
  h.runTick();
  assert.equal(h.sockets.length, 1, 'no reconnect of the whole set');
  assert.equal(s.closed, false);
  assert.deepEqual(s.sent.at(-1), { type: 'subscribe', product_ids: ['ETH-USD'], channels: ['matches', 'heartbeat'] });
  assert.deepEqual(h.stream.getStatus().rejectedProducts, ['ZZZ-USD']);
  // The exclusion expires; the product is requested again.
  h.clock.now += 15 * 60000;
  h.message(s, { type: 'heartbeat', product_id: 'BTC-USD', time: h.iso(h.clock.now) });
  h.runTick();
  assert.deepEqual(h.stream.getStatus().rejectedProducts, []);
  assert.ok(s.sent.at(-1).product_ids.includes('ZZZ-USD'), JSON.stringify(s.sent.at(-1)));
  // A subscribe failure that names no requested product still fails the socket.
  h.message(s, { type: 'error', message: 'Failed to subscribe', reason: 'too many subscriptions' });
  assert.equal(s.closed, true);
  assert.equal(h.stream.getStatus().connected, false);
});

test('reconnects with exponential backoff after a close and resets the backoff on traffic', () => {
  const h = harness({ symbols: ['BTC/USD'] });
  h.stream.start();
  h.sockets[0].emit('open');
  h.sockets[0].emit('close');
  assert.equal(h.stream.getStatus().connected, false);
  assert.equal(h.stream.getReference('BTC/USD'), null);
  h.runTick();
  assert.equal(h.sockets.length, 1, 'waits for the 1 s backoff');
  h.clock.now += 1000;
  h.runTick();
  assert.equal(h.sockets.length, 2);
  h.sockets[1].emit('error', new Error('boom'));
  h.clock.now += 1000;
  h.runTick();
  assert.equal(h.sockets.length, 2, 'second failure doubles the wait to 2 s');
  h.clock.now += 1000;
  h.runTick();
  assert.equal(h.sockets.length, 3);
  h.sockets[2].emit('open');
  h.message(h.sockets[2], { type: 'heartbeat', product_id: 'BTC-USD', time: h.iso(h.clock.now) });
  assert.equal(h.stream.getStatus().backoffMs, 1000);
  // A message on an old socket is ignored.
  h.message(h.sockets[0], { type: 'match', trade_id: 1, product_id: 'BTC-USD', price: '1', time: h.iso(h.clock.now) });
  assert.equal(h.stream.getReference('BTC/USD'), null);
});

test('watchdog reconnects when no message arrives for more than 15 s', () => {
  const h = harness({ symbols: ['BTC/USD'] });
  h.stream.start();
  h.sockets[0].emit('open');
  h.message(h.sockets[0], { type: 'match', trade_id: 1, product_id: 'BTC-USD', price: '100', time: h.iso(h.clock.now) });
  h.clock.now += 15000;
  h.runTick();
  assert.equal(h.sockets[0].closed, false, '15 s is still within the watchdog window');
  h.clock.now += 1;
  h.runTick();
  assert.equal(h.sockets[0].closed, true);
  assert.equal(h.stream.getStatus().watchdogReconnects, 1);
  assert.equal(h.stream.getReference('BTC/USD'), null);
  h.clock.now += 1000;
  h.runTick();
  assert.equal(h.sockets.length, 2);
});

test('stop closes the socket and later messages are ignored', () => {
  const h = harness({ symbols: ['BTC/USD'] });
  h.stream.start();
  const s = h.sockets[0];
  s.emit('open');
  h.stream.stop();
  assert.equal(s.closed, true);
  h.message(s, { type: 'match', trade_id: 1, product_id: 'BTC-USD', price: '100', time: h.iso(h.clock.now) });
  assert.equal(h.stream.getReference('BTC/USD'), null);
  assert.equal(h.stream.getStatus().connected, false);
});
