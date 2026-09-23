import test from 'node:test';
import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { sendChunkedJson } from '../routes/chunkedJson.js';
import { gunzipSync } from 'node:zlib';

for (const limit of [128, 8*1024*1024]) test(`bounded gzip response preserves every field at budget ${limit}`, async()=>{
  const chunks=[];let serialized=0;
  const res=new Writable({highWaterMark:1,write(chunk,_encoding,done){chunks.push(chunk);setImmediate(done)}});
  res.setHeader=()=>{};
  const row={symbol:'EUR/USD',toJSON(){serialized++;return {symbol:this.symbol,text:'株🟢'.repeat(1000),approved:false}}};
  const payload={success:true,signals:[row],approvedSignals:[],watchSignals:[row],missing:undefined,nullable:null};
  const finished=new Promise(resolve=>res.once('finish',resolve));
  const delivery=await sendChunkedJson(res,payload,{gzip:true,bufferLimitBytes:limit});await finished;
  assert.equal(delivery.buffered,limit>128);
  const result=JSON.parse(gunzipSync(Buffer.concat(chunks)));
  assert.equal(serialized,2,'each occurrence serialized once, including streaming fallback');
  assert.deepEqual(result.signals,result.watchSignals);assert.equal(result.signals[0].approved,false);
  assert.equal(result.nullable,null);assert.ok(!('missing' in result));assert.equal(res.listenerCount('drain'),0);
});

test('measured ten-MiB feed uses bounded delivery instead of zlib drain round trips',async()=>{
  const row={symbol:'AAPL',evidence:'x'.repeat(100000),approved:false};
  const rows=Array(50).fill(row),payload={signals:rows,watchSignals:rows,approvedSignals:[]};
  const chunks=[];const res=new Writable({write(chunk,_encoding,done){chunks.push(chunk);done()}});res.setHeader=()=>{};
  const finished=new Promise(resolve=>res.once('finish',resolve));
  const delivery=await sendChunkedJson(res,payload,{gzip:true,bufferLimitBytes:32*1024*1024});await finished;
  assert.equal(delivery.buffered,true);assert.ok(delivery.inputBytes>8*1024*1024);
  assert.ok(delivery.inputBytes<32*1024*1024);
  assert.deepEqual(JSON.parse(gunzipSync(Buffer.concat(chunks))),payload);
});

test('chunked JSON preserves all fields and honors slow-client backpressure', async () => {
  const chunks = [];
  const res = new Writable({ highWaterMark: 16, write(chunk, _encoding, done) {
    chunks.push(chunk.toString()); setImmediate(done);
  } });
  res.setHeader = () => {};
  const payload = { success: true, missing: undefined, signals: Array.from({ length: 40 }, (_, i) => ({ symbol: `S${i}`, evidence: 'x'.repeat(1000) })), empty: [], nullable: null };
  const finished = new Promise(resolve => res.once('finish', resolve));
  await sendChunkedJson(res, payload); await finished;
  assert.deepEqual(JSON.parse(chunks.join('')), JSON.parse(JSON.stringify(payload)));
  assert.ok(Math.max(...chunks.map(chunk => chunk.length)) < 1100);
  assert.equal(res.listenerCount('drain'), 0);
});

test('a disconnected client aborts JSON delivery and releases drain listeners', async () => {
  const res = new Writable({ highWaterMark: 1, write(_chunk, _encoding, _done) { setImmediate(() => this.destroy()); } });
  res.setHeader = () => {};
  await assert.rejects(sendChunkedJson(res, { signals: [1,2,3] }), /Response closed/);
  assert.equal(res.listenerCount('drain'), 0);
});

test('gzip delivery preserves the full JSON contract with bounded streaming', async () => {
  const chunks = [], headers = {};
  const res = new Writable({ write(chunk, _encoding, done) { chunks.push(chunk); setImmediate(done); } });
  res.setHeader = (name, value) => { headers[name] = value; };
  const payload = { signals: Array.from({ length: 50 }, () => ({ symbol: 'AAPL', description: 'x'.repeat(10000) })) };
  const finished = new Promise(resolve => res.once('finish', resolve));
  await sendChunkedJson(res, payload, { gzip: true }); await finished;
  const bytes = Buffer.concat(chunks);
  assert.deepEqual(JSON.parse(gunzipSync(bytes)), payload);
  assert.equal(headers['Content-Encoding'], 'gzip');
  assert.ok(bytes.length < JSON.stringify(payload).length / 10);
});

test('batched gzip preserves unicode, repeated candidates and rows larger than its batch', async () => {
  const chunks = [];
  const res = new Writable({ highWaterMark: 1, write(chunk, _encoding, done) {
    chunks.push(chunk); setImmediate(done);
  } });
  res.setHeader = () => {};
  const row = { symbol: 'BTC/USD', text: '株🟢'.repeat(200000) };
  const payload = { signals: [row], watchSignals: [row], empty: [], zero: 0 };
  const finished = new Promise(resolve => res.once('finish', resolve));
  await sendChunkedJson(res, payload, { gzip: true }); await finished;
  assert.deepEqual(JSON.parse(gunzipSync(Buffer.concat(chunks))), payload);
});

test('disconnected gzip delivery stops without retaining drain listeners', async () => {
  const res = new Writable({ highWaterMark: 1, write(_chunk, _encoding, done) { done(); } });
  res.setHeader = () => {};
  res.destroy();
  await assert.rejects(sendChunkedJson(res, { signals: [{ symbol: 'AAPL' }] }, { gzip: true }), /Response closed/);
  assert.equal(res.listenerCount('drain'), 0);
});

test('disconnected bounded response does not serialize evidence at all',async()=>{
  const res=new Writable({write(_chunk,_encoding,done){done()}});
  res.setHeader=()=>{};res.destroy();
  const row={toJSON(){assert.fail('closed response must not serialize')}};
  await assert.rejects(sendChunkedJson(res,{signals:[row]},{gzip:true,bufferLimitBytes:8388608}),/Response closed/);
});
