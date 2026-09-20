import test from 'node:test';
import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { sendChunkedJson } from '../routes/chunkedJson.js';
import { gunzipSync } from 'node:zlib';

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
