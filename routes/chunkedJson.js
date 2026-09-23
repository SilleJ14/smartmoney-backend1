import { createGzip, gzipSync } from 'node:zlib';

// This generator also supplies the streaming fallback. Crossing the bounded
// fast-path budget never serializes a row twice or loses part of the response.
function* jsonChunks(payload) {
  yield '{';
  let first = true;
  for (const [key, value] of Object.entries(payload)) {
    if (value === undefined) continue;
    yield `${first ? '' : ','}${JSON.stringify(key)}:`; first = false;
    if (!Array.isArray(value)) { yield JSON.stringify(value); continue; }
    yield '[';
    for (let i = 0; i < value.length; i++) yield `${i ? ',' : ''}${JSON.stringify(value[i]) ?? 'null'}`;
    yield ']';
  }
  yield '}';
}
// Preserve the JSON contract. Streaming bounds work to an array item; the
// opt-in compressed fast path holds at most 32 MiB plus one overflow item.
// Slow clients cannot make this helper enqueue an unbounded response.
export async function sendChunkedJson(res, payload, { gzip = false, bufferLimitBytes = 0 } = {}) {
  if (typeof res.write !== 'function') return res.json(payload);
  if (res.destroyed) throw new Error('Response closed');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  const iterator = jsonChunks(payload);
  const prefix = [];
  let prefixBytes = 0;
  // Opt-in for the frequently polled candidate response. Avoid zlib thread-pool
  // round trips competing with durable history I/O for an ordinary-sized feed.
  // No cross-request cache: evidence/approval is still rechecked on every read.
  const budget = Math.min(32 * 1024 * 1024, Math.max(0, bufferLimitBytes));
  if (gzip && budget) {
    while (true) {
      const part = iterator.next();
      if (part.done) {
        const compressed = gzipSync(prefix.join(''), { level: 1 });
        res.setHeader('Content-Encoding', 'gzip');
        res.setHeader('Vary', 'Accept-Encoding');
        res.end(compressed);
        return { buffered: true, inputBytes: prefixBytes, outputBytes: compressed.length };
      }
      prefix.push(part.value);
      prefixBytes += Buffer.byteLength(part.value);
      if (prefixBytes > budget) break;
    }
  }
  // Keep compression bounded, but avoid a thread-pool/drain round trip for
  // each small JSON fragment while scans and history writes are active.
  const output = gzip ? createGzip({ level: 1, chunkSize: 64 * 1024, highWaterMark: 1024 * 1024 }) : res;
  if (gzip) {
    res.setHeader('Content-Encoding', 'gzip');
    res.setHeader('Vary', 'Accept-Encoding');
    output.on('error', () => res.destroy());
    res.once('close', () => output.destroy());
    output.pipe(res);
  }
  async function writeDirect(chunk) {
    if (res.destroyed || output.destroyed) throw new Error('Response closed');
    if (output.write(chunk)) return;
    await new Promise((resolve, reject) => {
      const cleanup = () => {
        output.removeListener('drain', drain); output.removeListener('close', close); output.removeListener('error', error);
      };
      const drain = () => { cleanup(); resolve(); };
      const close = () => { cleanup(); reject(new Error('Response closed')); };
      const error = err => { cleanup(); reject(err); };
      output.once('drain', drain); output.once('close', close); output.once('error', error);
      if (res.destroyed || output.destroyed) close();
    });
  }
  // Zlib processes writes sequentially. Sending every punctuation fragment and
  // row separately required hundreds of event-loop/thread-pool round trips.
  // Batch at most 512 KiB, never an entire response; large individual rows go
  // straight through and slow/disconnected clients still apply backpressure.
  let fragments = [], fragmentBytes = 0;
  async function flush() {
    if (!fragmentBytes) return;
    const chunk = fragments.join('');
    fragments = []; fragmentBytes = 0;
    await writeDirect(chunk);
  }
  async function write(chunk) {
    if (res.destroyed || output.destroyed) throw new Error('Response closed');
    if (!gzip) return writeDirect(chunk);
    const bytes = Buffer.byteLength(chunk);
    if (fragmentBytes + bytes > 512 * 1024) await flush();
    if (bytes >= 512 * 1024) return writeDirect(chunk);
    fragments.push(chunk); fragmentBytes += bytes;
  }
  let yieldAt = performance.now() + 100;
  for (let i = 0; i < prefix.length; i++) { await write(prefix[i]); prefix[i] = null; }
  for (const chunk of iterator) {
    await write(chunk);
    if (performance.now() >= yieldAt) {
      await new Promise(resolve => setImmediate(resolve));
      yieldAt = performance.now() + 100;
    }
  }
  await flush(); output.end();
  return { buffered: false, inputBytes: prefixBytes };
}
