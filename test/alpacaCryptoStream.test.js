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
