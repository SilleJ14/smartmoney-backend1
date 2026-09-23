import fs from 'node:fs';
import path from 'node:path';

// A later successful write must not erase an earlier learning-data gap.
// Small bounded audit records only; never retain full candidate graphs.
export function createOutcomeFailureReporter(directory, { logger = console, io = fs, now = Date.now } = {}) {
  const file = path.join(directory, 'outcome-gaps.jsonl');
  const previous = path.join(directory, 'outcome-gaps.previous.jsonl');
  const limit = 1024 * 1024;
  return ({ candidates = [], prices = [], options = {}, error } = {}) => {
    const row = { event: 'OUTCOME_RECORDING_GAP', at: new Date(now()).toISOString(),
      assetClass: options.assetClass, observedAt: options.now, dayKey: options.dayKey,
      candidateCount: candidates.length, priceCount: prices.length,
      symbols: candidates.slice(0, 200).map(r => String(r.symbol || r.s || r.T || '').slice(0, 32)),
      symbolsTruncated: candidates.length > 200,
      reason: error?.code === 'OUTCOME_STORAGE_BACKPRESSURE' ? 'STORAGE_BACKPRESSURE' : 'STORAGE_WRITE_FAILED',
      retryStatus: 'NOT_REPLAYED', durable: true };
    try {
      io.mkdirSync(directory, { recursive: true });
      const line = JSON.stringify(row) + '\n';
      if (io.existsSync(file) && io.statSync(file).size + Buffer.byteLength(line) > limit) {
        if (io.existsSync(previous)) io.unlinkSync(previous);
        io.renameSync(file, previous);
      }
      const fd = io.openSync(file, 'a', 0o600);
      try { io.writeSync(fd, line); io.fsyncSync(fd); } finally { io.closeSync(fd); }
    } catch { row.durable = false; }
    try { logger.error('OUTCOME_RECORDING_GAP', JSON.stringify(row)); } catch { /* never mask original failure */ }
    return row;
  };
}
