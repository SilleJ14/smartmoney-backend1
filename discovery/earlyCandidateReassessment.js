// Bounded FIFO research: new names get a turn without waiting for a whole scan.
export function freshEarlyAssessments(rows = [], now = Date.now()) {
  return (Array.isArray(rows) ? rows : []).slice(-60).filter(row => {
    const age = now - Date.parse(row.analysisUpdatedAt || '');
    return age >= 0 && age <= 15 * 60000;
  });
}
export function createEarlyCandidateReassessment({ analyze, publish, trace = () => {},
  canRun = () => true, now = Date.now, capacity = 120, batchSize = 2, retryMs = 120000,
  acceptsSymbol = symbol => /^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol) }) {
  const queue = new Map(), reviewed = new Map();
  let running = null;
  const status = { completedBatches: 0, failures: 0, lastScored: 0, lastCompletedAt: null, lastDurationMs: null };
  function enqueue(candidates) {
    for (const candidate of candidates.slice(0, capacity * 2)) {
      const symbol = String(candidate?.symbol || candidate || '').toUpperCase();
      if (!acceptsSymbol(symbol) || queue.has(symbol)) continue;
      if (reviewed.has(symbol) && now() - reviewed.get(symbol) < retryMs) continue;
      if (queue.size >= capacity) break;
      queue.set(symbol, now()); trace({ symbol, stage: 'EARLY_ANALYSIS_QUEUED' });
    }
  }
  function run(candidates = []) {
    enqueue(candidates);
    if (running) return running;
    if (!canRun() || !queue.size) return Promise.resolve({ skipped: true, pending: queue.size });
    const selected = [...queue.keys()].slice(0, batchSize);
    const startedAt = now();
    for (const symbol of selected) { queue.delete(symbol); reviewed.set(symbol, now()); trace({ symbol, stage: 'EARLY_ANALYSIS_STARTED' }); }
    while (reviewed.size > capacity) reviewed.delete(reviewed.keys().next().value);
    running = Promise.resolve().then(() => analyze(selected)).then(async rows => {
      const published = await publish(rows);
      if (published === false) return { superseded: true, pending: queue.size };
      Object.assign(status, { completedBatches: status.completedBatches + 1, lastScored: rows.length,
        lastCompletedAt: new Date(now()).toISOString(), lastDurationMs: now() - startedAt });
      for (const symbol of selected) {
        const row = rows.find(r => r.symbol === symbol);
        trace({ ...(row || {}), symbol, stage: row ? 'EARLY_ANALYSIS_COMPLETED' : 'EARLY_ANALYSIS_NO_RESULT',
          reasons: row?.missingEvidenceReasons || ['EVIDENCE_OR_INSTRUMENT_FILTER_FAILED'] });
      }
      return { reviewed: selected.length, scored: rows.length, pending: queue.size };
    }).catch(() => {
      status.failures += 1;
      for (const symbol of selected) trace({ symbol, stage: 'EARLY_ANALYSIS_FAILED', reasons: ['RETRY_AFTER_COOLDOWN'] });
      return { failed: true, pending: queue.size };
    }).finally(() => { running = null; });
    return running;
  }
  return { run, getStatus: () => ({ ...status, pending: queue.size, running: running !== null }) };
}
