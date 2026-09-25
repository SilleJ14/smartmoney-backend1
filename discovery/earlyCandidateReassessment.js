// Bounded research queue. A higher-priority arrival replaces the lowest occupant
// when the queue is full. Equal priority does not thrash an occupant.

import { evidencePriority } from "./evidencePriority.js";
export function freshEarlyAssessments(rows = [], now = Date.now()) {
  return (Array.isArray(rows) ? rows : []).slice(-60).filter(row => {
    const age = now - Date.parse(row.analysisUpdatedAt || '');
    return age >= 0 && age <= 15 * 60000;
  });
}
export function createEarlyCandidateReassessment({ analyze, publish, trace = () => {},
  canRun = () => true, now = Date.now, capacity = 120, batchSize = 2, retryMs = 120000, minStartIntervalMs = 0,
  acceptsSymbol = symbol => /^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol) }) {
  const queue = new Map(), reviewed = new Map(), events = new Map();
  let running = null, lastStartedAt = -Infinity;
  const status = { completedBatches: 0, failures: 0, lastScored: 0, lastCompletedAt: null, lastDurationMs: null,
    deferredByCapacity: 0, evictedByPriority: 0, maxObservedQueueWaitMs: 0, lastQueueWaitMs: null };
  function queueRank(candidate) {
    const explicit = Math.max(0, Math.min(3, Number(candidate?.reassessmentPriority) || 0));
    if (!candidate || typeof candidate !== "object") return explicit;
    const evidence = evidencePriority(candidate, { now: now() });
    const measured = evidence.currentF !== null || evidence.currentD > 0;
    const base = measured ? evidence.priority : explicit;
    return explicit >= 3 ? base + 1000 : base;
  }
  function enqueue(candidates) {
    for (const candidate of candidates.slice(0, capacity * 2)) {
      const symbol = String(candidate?.symbol || candidate || '').toUpperCase();
      if (!acceptsSymbol(symbol)) continue;
      const event = typeof candidate?.reassessmentEvent === 'string' ? candidate.reassessmentEvent.slice(0, 160) : null;
      const changed = event && event !== events.get(symbol);
      const priority = queueRank(candidate);
      if (queue.has(symbol)) {
        const pending = queue.get(symbol);
        pending.priority = Math.max(pending.priority, priority);
        continue;
      }
      // New material evidence may bypass the normal cooldown, but not a burst
      // bound of five seconds. Identical events never bypass it.
      if (reviewed.has(symbol) && now() - reviewed.get(symbol) < (changed ? 5000 : retryMs)) continue;
      if (queue.size >= capacity) {
        let victim = null;
        for (const [queuedSymbol, pending] of queue) {
          if (!victim || pending.priority < victim.priority || (pending.priority === victim.priority && pending.at >= victim.at)) {
            victim = { symbol: queuedSymbol, priority: pending.priority, at: pending.at };
          }
        }
        if (victim && priority > victim.priority) {
          queue.delete(victim.symbol);
          status.evictedByPriority += 1;
          trace({ symbol: victim.symbol, stage: 'EARLY_ANALYSIS_EVICTED', reasons: ['HIGHER_PRIORITY_ARRIVAL'] });
        } else {
          status.deferredByCapacity++;
          trace({ symbol, stage: 'EARLY_ANALYSIS_DEFERRED', reasons: ['QUEUE_CAPACITY'] });
          continue;
        }
      }
      if (event) events.set(symbol, event);
      while (events.size > capacity) events.delete(events.keys().next().value);
      queue.set(symbol, { at: now(), priority }); trace({ symbol, stage: 'EARLY_ANALYSIS_QUEUED', trigger: event });
    }
  }
  function run(candidates = []) {
    enqueue(candidates);
    if (running) return running;
    if (!canRun() || !queue.size || now() - lastStartedAt < minStartIntervalMs) return Promise.resolve({ skipped: true, pending: queue.size });
    // Age lifts ordinary candidates above priority work after a bounded wait.
    const selected = [...queue.keys()].sort((a, b) => {
      const rank = s => queue.get(s).priority + Math.floor((now() - queue.get(s).at) / 15000);
      return rank(b) - rank(a) || queue.get(a).at - queue.get(b).at;
    }).slice(0, batchSize);
    const startedAt = now();
    const queuedAtBySymbol = new Map(selected.map(symbol => [symbol, queue.get(symbol).at]));
    lastStartedAt = startedAt;
    for (const symbol of selected) {
      const queueWaitMs = Math.max(0, startedAt - queue.get(symbol).at);
      status.lastQueueWaitMs = queueWaitMs;
      status.maxObservedQueueWaitMs = Math.max(status.maxObservedQueueWaitMs, queueWaitMs);
      queue.delete(symbol); reviewed.set(symbol, now());
      trace({ symbol, stage: 'EARLY_ANALYSIS_STARTED', queueWaitMs });
    }
    while (reviewed.size > capacity) reviewed.delete(reviewed.keys().next().value);
    running = Promise.resolve().then(() => analyze(selected)).then(async rows => {
      const published = await publish(rows);
      if (published === false) {
        // A full scan can start while provider requests are in flight. Discarded
        // work must not consume the normal per-symbol cooldown.
        for (const symbol of selected) reviewed.delete(symbol);
        enqueue(selected);
        return { superseded: true, pending: queue.size };
      }
      Object.assign(status, { completedBatches: status.completedBatches + 1, lastScored: rows.length,
        lastCompletedAt: new Date(now()).toISOString(), lastDurationMs: now() - startedAt });
      for (const symbol of selected) {
        const row = rows.find(r => r.symbol === symbol);
        trace({ ...(row || {}), symbol, stage: row ? 'EARLY_ANALYSIS_COMPLETED' : 'EARLY_ANALYSIS_NO_RESULT',
          totalDecisionLatencyMs: Math.max(0, now() - queuedAtBySymbol.get(symbol)),
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
  return { run, getStatus: () => ({ ...status, pending: queue.size, running: running !== null,
    oldestPendingWaitMs: queue.size ? Math.max(0, now() - queue.values().next().value.at) : 0 }) };
}
