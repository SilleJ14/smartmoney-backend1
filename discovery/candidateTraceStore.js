import fs from 'node:fs/promises';
import path from 'node:path';
import { candidateDiagnostics } from '../scoring/candidateDiagnostics.js';
import { getApprovedTradeAmount } from '../scoring/approvedSizing.js';
import { createPipelineLatency } from '../analytics/pipelineLatency.js';
import { archivePolicyBundle, policyManifest } from '../scoring/policyBundle.js';

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
  const crypto = symbol.includes('/') || event.assetClass === 'crypto';
  const evidence = crypto ? event.cryptoScoreTelemetry?.decision : event.stockDecisionEvidence;
  const diagnosis = evidence ? candidateDiagnostics(event, evidence, event.executionEligibility || { reasons: event.reasons || [] }) : null;
  return {
    symbol, assetClass: symbol.includes('/') || event.assetClass === 'crypto' ? 'crypto' : 'stock',
    observedAt: new Date().toISOString(), providerAt: timestamp(event.liveQuoteUpdatedAt),
    stage: text(event.stage, 40), cycle: text(event.cycle, 64), source: text(event.source, 80),
    outcomeStatus: 'UNKNOWN',
    decisionRevision: number(event.decisionRevision),
    evidenceSnapshotId: text(event.decisionProvenance?.evidenceSnapshotId,64),
    scoringPolicyVersion: text(event.decisionProvenance?.scoringPolicyVersion,64),
    strategyVersion: text(event.decisionProvenance?.strategyVersion,64),
    evidencePolicyVersion: text(event.decisionProvenance?.evidencePolicyVersion,64),
    policyBundleId: text(event.decisionProvenance?.policyBundleId,64),
    releaseCommit: text(event.decisionProvenance?.releaseCommit,40),
    configurationSnapshotId: text(event.decisionProvenance?.configurationSnapshot?.id,64),
    // Config was allowlisted at snapshot creation; bound and re-filter on this boundary too.
    configurationValues: Object.fromEntries(Object.entries(event.decisionProvenance?.configurationSnapshot?.values || {})
      .filter(([key,value]) => /^[a-zA-Z]{1,60}$/.test(key) && !/key|secret|token|password|accountId/i.test(key) &&
        (value === null || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value))).slice(0,150)),
    riskPolicyVersion: text(event.riskPolicyVersion,64),
    calculationMs: number(event.decisionLatency?.calculationMs),
    totalDecisionLatencyMs: number(event.totalDecisionLatencyMs),
    outcomeReason: 'A scan or order event does not establish a realized trading outcome',
    queueWaitMs: number(event.queueWaitMs),
    orderId: text(event.orderId, 80), clientOrderId: text(event.clientOrderId, 80),
    orderStatus: text(event.orderStatus, 40), filledQty: number(event.filledQty),
    decisionAt: timestamp(event.decisionUpdatedAt), sizingAt: timestamp(event.sizingDecisionUpdatedAt),
    approvedAmount: getApprovedTradeAmount(event),
    approvalReported: event.executionEligibility?.approved === true,
    price: number(event.price ?? event.current), changePercent: number(event.percentChange ?? event.changePercent),
    discovery: (crypto ? event.cryptoDiscoveryScoreAvailable : event.discoveryScoreAvailable) === false ? null : number(crypto ? event.cryptoDiscoveryScore : event.discoveryScore),
    entry: (crypto ? event.cryptoEntryScoreAvailable : event.entryQualityScoreAvailable) === false ? null : number(crypto ? event.cryptoEntryScore : event.entryQualityScore),
    diagnostics: diagnosis ? { status: diagnosis.status, missingEvidencePoints: diagnosis.missingEvidencePoints,
      measuredShortfallPoints: diagnosis.measuredShortfallPoints, components: diagnosis.components,
      blockingReasons: diagnosis.blockingReasons.slice(0,32).map(x => text(x)).filter(Boolean) } : null,
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
  let persistenceFailures = 0, firstLossAt = null, lastLossAt = null;
  const latency = createPipelineLatency();
  const markLoss = () => { lastLossAt = new Date().toISOString(); firstLossAt ||= lastLossAt; };
  const observedStates = new Map();
  const journeys = new Map();
  const file = index => path.join(directory, `candidate-trace-${index}.jsonl`);
  async function initialize() {
    if (initialized) return;
    await fs.mkdir(directory, { recursive: true });
    await archivePolicyBundle(directory);
    const stats = await Promise.all(Array.from({ length: fileCount }, async (_, index) => {
      try { return { index, ...(await fs.stat(file(index))) }; }
      catch (error) { if (error.code !== 'ENOENT') throw error; return null; }
    }));
    const latest = stats.filter(Boolean).sort((a, b) => b.mtimeMs - a.mtimeMs)[0];
    if (latest) { slot = latest.index; size = latest.size; }
    // Restore first-observed metadata from retained rows, not a fresh process
    // timestamp. Read one capped buffer at a time; never load an unbounded file.
    for (const stat of stats.filter(Boolean)) {
      const handle = await fs.open(file(stat.index), 'r');
      try {
        const buffer = Buffer.alloc(fileBytes);
        const { bytesRead } = await handle.read(buffer, 0, fileBytes, 0);
        for (const line of buffer.subarray(0, bytesRead).toString('utf8').split('\n')) {
          try {
            const row = JSON.parse(line);
            if (!row.symbol || !timestamp(row.observedAt)) continue;
            const firstObservedAt = timestamp(row.journey?.firstObservedAt) || row.observedAt;
            const previous = journeys.get(row.symbol);
            if (!previous || Date.parse(firstObservedAt) < Date.parse(previous.firstObservedAt)) {
              journeys.set(row.symbol, { firstObservedAt,
                firstObservedPrice: number(row.journey?.firstObservedPrice ?? row.price) });
              if (journeys.size > 1000) journeys.delete(journeys.keys().next().value);
            }
          } catch { /* interrupted/corrupt row is not evidence */ }
        }
      } finally { await handle.close(); }
    }
    initialized = true;
  }
  async function drain() {
    try {
      await initialize();
      while (queue.length) {
        const row = JSON.parse(queue[0]);
        if (row.symbol) {
          const first = journeys.get(row.symbol) || row.journey;
          row.journey = { ...first,
            elapsedSeconds: Math.max(0, (Date.parse(row.observedAt) - Date.parse(first.firstObservedAt)) / 1000),
            scope: 'First observed in retained history; unrecorded or evicted history is unknown' };
        }
        const line = JSON.stringify(row) + '\n', bytes = Buffer.byteLength(line);
        if (bytes > fileBytes) { queue.shift(); dropped++; markLoss(); continue; }
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
      persistenceFailures++; markLoss();
      dropped += queue.length; queue = [];
      initialized = false;
    }
  }
  function record(event) {
    const compact = compactCandidateTrace(event);
    if (!compact) return false;
    latency.observe(compact.assetClass,'queueWaitMs',compact.queueWaitMs);
    latency.observe(compact.assetClass,'calculationMs',compact.calculationMs);
    latency.observe(compact.assetClass,'totalDecisionLatencyMs',compact.totalDecisionLatencyMs);
    const journey = journeys.get(compact.symbol) || { firstObservedAt: compact.observedAt, firstObservedPrice: compact.price };
    journeys.delete(compact.symbol); journeys.set(compact.symbol, journey);
    if (journeys.size > 1000) journeys.delete(journeys.keys().next().value);
    compact.journey = { ...journey, elapsedSeconds: Math.max(0, (Date.parse(compact.observedAt) - Date.parse(journey.firstObservedAt)) / 1000),
      scope: 'Observed process window; earlier unrecorded history is unknown' };
    if (compact.diagnostics) {
      const previous = observedStates.get(compact.symbol);
      const since = previous?.status === compact.diagnostics.status ? previous.since : compact.observedAt;
      compact.diagnostics.statusSince = since;
      compact.diagnostics.observedWaitingSeconds = Math.max(0, (Date.parse(compact.observedAt) - Date.parse(since)) / 1000);
      observedStates.delete(compact.symbol);
      observedStates.set(compact.symbol, { status: compact.diagnostics.status, since });
      if (observedStates.size > 500) observedStates.delete(observedStates.keys().next().value);
    }
    return enqueue(compact);
  }
  function recordScan(event = {}) {
    if (!/^SCAN_(STARTED|SKIPPED|FAILED|COMPLETED|PERSISTENCE_FAILED|COVERAGE)$/.test(event.stage || '')) return false;
    return enqueue({ kind: 'scan', observedAt: new Date().toISOString(), stage: event.stage,
      cycle: text(event.cycle, 64), reason: text(event.reason, 80), durationMs: number(event.durationMs),
      assetClass: text(event.assetClass, 10), eligibleCount: number(event.eligibleCount),
      selectedCount: number(event.selectedCount), individuallyRecordedCount: number(event.individuallyRecordedCount) });
  }
  function enqueue(compact) {
    const line = JSON.stringify(compact) + '\n';
    if (queue.length >= queueLimit || Buffer.byteLength(line) > fileBytes) { dropped++; markLoss(); return false; }
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
    oldestPendingAgeMs: queue.length ? Math.max(0, Date.now() - Date.parse(JSON.parse(queue[0]).observedAt)) : 0,
    diagnosticsStatus: lastError || dropped > 0 ? 'DIAGNOSTICS_DEGRADED' : 'AVAILABLE',
    tracePersistenceFailures: persistenceFailures, firstLossAt, lastLossAt,
    latency: latency.summary(),
    policyArchive: { ...policyManifest, maxDiskBytes: 8 * 1048576 },
    maxQueue: queueLimit, maxDiskBytes: fileCount * fileBytes,
    retention: 'Rolling bounded history; not a complete market archive. Requires a persistent DATA_DIR to survive deployment.' });
  async function read(symbol, requestedLimit = 100) {
    if (symbol !== null && !/^[A-Z0-9][A-Z0-9._-]{0,15}(?:\/[A-Z0-9]{1,10})?$/.test(symbol || '')) throw new Error('INVALID_SYMBOL');
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
            try { const row = JSON.parse(line); if (symbol === null ? row.kind === 'scan' : row.symbol === symbol) events.push(row); } catch { /* interrupted final line */ }
          }
          events.sort((a, b) => b.observedAt.localeCompare(a.observedAt));
          events.length = Math.min(events.length, limit);
        } catch (error) { if (error.code !== 'ENOENT') throw error; }
        finally { await handle?.close(); }
      }
      const ordered = [...events].sort((a,b) => a.observedAt.localeCompare(b.observedAt));
      const stageTimeline = ordered.map((row, index) => ({ stage: row.stage || 'UNKNOWN', at: row.observedAt,
        secondsSincePreviousObservedEvent: index ? Math.max(0, (Date.parse(row.observedAt) - Date.parse(ordered[index-1].observedAt)) / 1000) : null }));
      return { events, ...status(), limit,
        ...(symbol === null ? {} : { stageTimeline, outcome: { status: 'UNKNOWN',
          reason: 'No linked realized outcome is established by this bounded event history; consult the order/outcome journal' } }) };
    } finally { querying = false; }
  }
  return { record, recordScan, read, status, flush: async () => { while (worker) await worker; } };
}
