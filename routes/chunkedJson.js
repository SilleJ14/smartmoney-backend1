import { createGzip } from 'node:zlib';
// Preserve the JSON contract while bounding serialization to one array item.
// Await slow clients instead of accumulating a second in-memory response.
export async function sendChunkedJson(res, payload, { gzip = false } = {}) {
  if (typeof res.write !== 'function') return res.json(payload);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  const output = gzip ? createGzip({ level: 1 }) : res;
  if (gzip) {
    res.setHeader('Content-Encoding', 'gzip');
    res.setHeader('Vary', 'Accept-Encoding');
    output.on('error', () => res.destroy());
    res.once('close', () => output.destroy());
    output.pipe(res);
  }
  async function write(chunk) {
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
  await write('{');
  let first = true, items = 0;
  for (const [key, value] of Object.entries(payload)) {
    if (value === undefined) continue;
    await write(`${first ? '' : ','}${JSON.stringify(key)}:`); first = false;
    if (!Array.isArray(value)) { await write(JSON.stringify(value)); continue; }
    await write('[');
    for (let i = 0; i < value.length; i++) {
      await write(`${i ? ',' : ''}${JSON.stringify(value[i]) ?? 'null'}`);
      if (++items % 8 === 0) await new Promise(resolve => setImmediate(resolve));
    }
    await write(']');
  }
  await write('}'); output.end();
}
