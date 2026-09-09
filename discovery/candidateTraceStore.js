import fs from 'node:fs/promises';
import path from 'node:path';

const text = (value, max = 120) => typeof value === 'string' ? value.slice(0, max) : null;
const number = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
const timestamp = value => {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const n = typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(n) && n > 0 && n <= Date.now() + 5000 ? new Date(n).toISOString() : null;
};

// Deliberately excludes arbitrary metadata, arrays of bars, account data and keys.
export function compactCandidateTrace(event = {}) {
  const symbol = text(event.symbol, 32)?.toUpperCase();
  if (!symbol || !/^[A-Z0-9][A-Z0-9._-]{0,15}(?:\/[A-Z0-9]{1,10})?$/.test(symbol)) return null;
  return {
    symbol, assetClass: symbol.includes('/') || event.assetClass === 'crypto' ? 'crypto' : 'stock',
    observedAt: new Date().toISOString(), providerAt: timestamp(event.liveQuoteUpdatedAt),
    stage: text(event.stage, 40), cycle: text(event.cycle, 64), source: text(event.source, 80),
    price: number(event.price ?? event.current), changePercent: number(event.percentChange ?? event.changePercent),
    discovery: event.discoveryScoreAvailable === false ? null : number(event.discoveryScore),
    entry: event.entryQualityScoreAvailable === false ? null : number(event.entryQualityScore),
    final: event.stockDecisionScoreAvailable === true ? number(event.stockDecisionScore)
      : event.cryptoDecisionScoreAvailable === true ? number(event.cryptoDecisionScore) : null,
    newsAvailable: event.confirmations?.newsRiskAvailable === true,
    reasons: (Array.isArray(event.reasons) ? event.reasons : []).slice(0, 8).map(x => text(x)).filter(Boolean),
  };
}

export function createCandidateTraceStore(directory, options = {}) {
  const fileCount = 8;
  const fileBytes = Math.max(4096, Math.min(1048576, options.fileBytes || 1048576));
  const queueLimit = 512;
  let queue = [], worker = null, initialized = false, slot = 0, size = 0;
  let written = 0, dropped = 0, lastError = null, querying = false;
  const file = index => path.join(directory, `candidate-trace-${index}.jsonl`);
  async function initialize() {
    if (initialized) return;
    await fs.mkdir(directory, { recursive: true });
    const stats = await Promise.all(Array.from({ length: fileCount }, async (_, index) => {
      try { return { index, ...(await fs.stat(file(index))) }; }
      catch (error) { if (error.code !== 'ENOENT') throw error; return null; }
    }));
    const latest = stats.filter(Boolean).sort((a, b) => b.mtimeMs - a.mtimeMs)[0];
    if (latest) { slot = latest.index; size = latest.size; }
    initialized = true;
  }
  async function drain() {
    try {
      await initialize();
      while (queue.length) {
        const line = queue[0], bytes = Buffer.byteLength(line);
        if (size + bytes > fileBytes) {
          slot = (slot + 1) % fileCount;
          await fs.writeFile(file(slot), '', { mode: 0o600 });
          size = 0;
        }
        await fs.appendFile(file(slot), line, { mode: 0o600 });
        size += bytes; queue.shift(); written++;
      }
      lastError = null;
    } catch (error) {
      // Diagnostics must not crash the engine or silently grow a retry backlog.
      lastError = text(error.code || 'TRACE_WRITE_FAILED', 40);
      dropped += queue.length; queue = [];
      initialized = false;
    }
  }
  function record(event) {
    const compact = compactCandidateTrace(event);
    if (!compact) return false;
    const line = JSON.stringify(compact) + '\n';
    if (queue.length >= queueLimit || Buffer.byteLength(line) > fileBytes) { dropped++; return false; }
    queue.push(line);
    startWorker();
    return true;
  }
  function startWorker() {
    if (!worker) worker = drain().finally(() => {
      worker = null;
      if (queue.length) startWorker();
    });
  }
  const status = () => ({ written, dropped, pending: queue.length, lastError,
    maxQueue: queueLimit, maxDiskBytes: fileCount * fileBytes,
    retention: 'Rolling bounded history; not a complete market archive. Requires a persistent DATA_DIR to survive deployment.' });
  async function read(symbol, requestedLimit = 100) {
    if (!/^[A-Z0-9][A-Z0-9._-]{0,15}(?:\/[A-Z0-9]{1,10})?$/.test(symbol || '')) throw new Error('INVALID_SYMBOL');
    if (querying) throw new Error('TRACE_QUERY_BUSY');
    querying = true;
    try {
      if (worker) await worker;
      const limit = Math.max(1, Math.min(200, Math.floor(Number(requestedLimit) || 100)));
      const events = [];
      // One capped buffer at a time, even if an external file is oversized.
      for (let index = 0; index < fileCount; index++) {
        let handle;
        try {
          handle = await fs.open(file(index), 'r');
          const buffer = Buffer.alloc(fileBytes);
          const { bytesRead } = await handle.read(buffer, 0, fileBytes, 0);
          for (const line of buffer.subarray(0, bytesRead).toString('utf8').split('\n')) {
            try { const row = JSON.parse(line); if (row.symbol === symbol) events.push(row); } catch { /* interrupted final line */ }
          }
          events.sort((a, b) => b.observedAt.localeCompare(a.observedAt));
          events.length = Math.min(events.length, limit);
        } catch (error) { if (error.code !== 'ENOENT') throw error; }
        finally { await handle?.close(); }
      }
      return { events, ...status(), limit };
    } finally { querying = false; }
  }
  return { record, read, status, flush: async () => { while (worker) await worker; } };
}
