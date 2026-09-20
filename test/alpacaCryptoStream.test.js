import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createAlpacaCryptoStream } from '../live/alpacaCryptoStream.js';
test('crypto quote stream authenticates, resubscribes and preserves quote timestamps', () => {
  let ws, tick, symbols = ['BTC/USD','AAPL']; const quotes = [];
  class Socket extends EventEmitter { constructor() { super(); ws = this; this.sent = []; } send(x) { this.sent.push(JSON.parse(x)); } close() {} }
  const now = Date.parse('2026-09-13T02:00:00Z');
  const stream = createAlpacaCryptoStream({ WebSocket: Socket, key:'fixture',secret:'fixture',getSymbols:()=>symbols,
    onQuote:(s,q)=>quotes.push(q), now:()=>now, setTimer:f=>{tick=f;return 1;},clearTimer:()=>{} });
  stream.start(); ws.emit('open');
  assert.equal(ws.sent[0].action,'auth');
  ws.emit('message',JSON.stringify([{T:'success',msg:'authenticated'}]));
  assert.deepEqual(ws.sent[1].quotes,['BTC/USD']);
  const stamp='2026-09-13T01:59:30Z';
  ws.emit('message',JSON.stringify([{T:'q',S:'BTC/USD',bp:99,ap:101,t:stamp}]));
  assert.equal(quotes[0].priceIsLive,false);assert.equal(quotes[0].spreadUpdatedAt,stamp.replace('Z','.000Z'));
  symbols=['LINK/USD'];tick();assert.deepEqual(ws.sent.at(-1).quotes,['LINK/USD']);
  const old=ws;stream.stop();old.emit('message',JSON.stringify([{T:'q',S:'BTC/USD',bp:99,ap:101,t:stamp}]));
  assert.equal(quotes.length,1);
});
test('crypto stream without credentials never opens a socket', () => {
  createAlpacaCryptoStream({WebSocket:class {constructor(){throw Error('must not connect');}},getSymbols:()=>[]}).start();
});

test('symbol limit rejection reduces the next batch without dropping REST coverage', () => {
  let ws, tick, now = 100000; let opened = 0;
  class Socket extends EventEmitter {
    constructor() { super(); ws = this; this.sent = []; opened++; }
    send(x) { this.sent.push(JSON.parse(x)); }
    close() {}
  }
  const stream = createAlpacaCryptoStream({ WebSocket: Socket, key: 'fixture', secret: 'fixture',
    getSymbols: () => ['BTC/USD', 'ETH/USD', 'SOL/USD', 'LINK/USD'], onQuote: () => {},
    now: () => now, setTimer: f => { tick = f; return 1; }, clearTimer: () => {} });
  const auth = () => { ws.emit('open'); ws.emit('message', JSON.stringify([{ T: 'success', msg: 'authenticated' }])); };
  stream.start(); auth();
  assert.equal(ws.sent[1].quotes.length, 4);
  ws.emit('message', JSON.stringify([{ T: 'error', code: 405 }]));
  assert.equal(stream.getStatus().symbolLimit, 2);
  tick(); assert.equal(opened, 1);
  now += 5000; tick(); auth();
  assert.equal(ws.sent[1].quotes.length, 2);
  assert.deepEqual(stream.getStatus().subscribedSymbols, ['BTC/USD', 'ETH/USD']);
  assert.equal(stream.getStatus().restOnlySymbolCount, 2);
  assert.equal(stream.getStatus().errorCode, null);
  // A later transport reconnect retains the learned limit.
  ws.emit('close'); now += 15000; tick(); auth();
  assert.equal(ws.sent[1].quotes.length, 2);
  stream.stop();
});
