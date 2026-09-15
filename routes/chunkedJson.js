// Preserve the JSON contract while bounding serialization to one array item.
// Await slow clients instead of accumulating a second in-memory response.
export async function sendChunkedJson(res, payload) {
  if (typeof res.write !== 'function') return res.json(payload);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  async function write(chunk) {
    if (res.destroyed) throw new Error('Response closed');
    if (res.write(chunk)) return;
    await new Promise((resolve, reject) => {
      const cleanup = () => {
        res.removeListener('drain', drain); res.removeListener('close', close); res.removeListener('error', error);
      };
      const drain = () => { cleanup(); resolve(); };
      const close = () => { cleanup(); reject(new Error('Response closed')); };
      const error = err => { cleanup(); reject(err); };
      res.once('drain', drain); res.once('close', close); res.once('error', error);
      if (res.destroyed) close();
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
  await write('}'); res.end();
}
