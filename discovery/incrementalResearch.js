// Quote-driven research, not order authorization. Never renew the age of the
// underlying bars/catalyst evidence when recalculating from a newer quote.
export function researchEvidenceTime(row = {}) {
  return Date.parse(row.researchEvidenceAt || row.analysisUpdatedAt || row.scoreAssessmentUpdatedAt || row.decisionUpdatedAt || '');
}

export function canReuseResearch(row = {}, now = Date.now()) {
  const at = researchEvidenceTime(row);
  return Number.isFinite(at) && now >= at && now - at < 120000 &&
    Math.floor(at / 300000) === Math.floor(now / 300000) &&
    Array.isArray(row.chartBars) && row.chartBars.length >= 24 &&
    Boolean(row.centralAutonomousDecisionCore) && !row.rawEarlyMover && row.setupRevalidationRequired !== true;
}

export function needsCandidateResearch(row, now = Date.now()) {
  return !canReuseResearch(row, now) || row.setupRevalidationRequired === true;
}

export function freshIncrementalResearch(rows = [], now = Date.now()) {
  return (Array.isArray(rows) ? rows : []).slice(-120).filter(row => canReuseResearch(row, now));
}

function approved(row) {
  return row.approved === true || row.backendApproved === true || row.autoTradeApproved === true ||
    row.qualifiedToBuy === true || row.executionEligibility?.approved === true || row.starterBuyApproved === true;
}

export function incrementalResearchForState(state, now = Date.now()) {
  const authoritative = ['lastStockSignals', 'lastCryptoSignals', 'topStockSignals', 'topCryptoSignals',
    'earlyAssessedStockSignals', 'topSignals', 'lastSignals'].flatMap(key => state[key] || []);
  return freshIncrementalResearch(state.incrementalResearchSignals, now).filter(row =>
    !authoritative.some(other => other.symbol === row.symbol &&
      (approved(other) || researchEvidenceTime(other) > researchEvidenceTime(row))));
}

export function createIncrementalResearch({ review, publish, canRun = () => true,
  accepts = () => true, now = Date.now, capacity = 120, batchSize = 4 }) {
  const reviewed = new Map();
  let running = false;
  const status = { completedBatches: 0, reviewed: 0, failures: 0, lastDurationMs: null, lastCompletedAt: null };
  function run(candidates = []) {
    if (running || !canRun()) return { skipped: true };
    const startedAt = now(), latest = new Map(), protectedSymbols = new Set();
    for (const row of candidates.slice(0, capacity * 4)) {
      if (!row?.symbol || !accepts(row)) continue;
      if (approved(row)) protectedSymbols.add(row.symbol);
      const previous = latest.get(row.symbol);
      if (!previous || !Number.isFinite(researchEvidenceTime(previous)) || researchEvidenceTime(row) > researchEvidenceTime(previous)) {
        latest.set(row.symbol, row);
      }
    }
    const selected = [...latest.values()].filter(row => !protectedSymbols.has(row.symbol) &&
      canReuseResearch(row, startedAt) && (!reviewed.has(row.symbol) || startedAt - reviewed.get(row.symbol) >= 5000))
      .sort((a, b) => (reviewed.get(a.symbol) ?? -Infinity) - (reviewed.get(b.symbol) ?? -Infinity))
      .slice(0, batchSize);
    if (!selected.length) return { skipped: true };
    running = true;
    try {
      const rows = selected.map(row => {
        reviewed.delete(row.symbol); reviewed.set(row.symbol, startedAt);
        while (reviewed.size > capacity) reviewed.delete(reviewed.keys().next().value);
        // Pure synchronous calculation; no provider requests or shared mutation.
        const result = review(structuredClone(row));
        if (!result || typeof result.then === 'function') throw new Error('Incremental research must be synchronous');
        return Object.assign(result, { researchEvidenceAt: new Date(researchEvidenceTime(row)).toISOString(),
          analysisUpdatedAt: new Date(startedAt).toISOString(), researchOnly: true,
          approved: false, backendApproved: false, autoTradeApproved: false, qualifiedToBuy: false,
          starterBuyApproved: false, buyableNow: false, recommendedTradeAmount: 0,
          finalApprovedTradeAmount: 0, finalTradeAmount: 0,
          executionEligibility: { approved: false, reasons: ['CENTRAL_RISK_AND_SIZING_REVIEW_REQUIRED'] } });
      });
      publish(rows);
      Object.assign(status, { completedBatches: status.completedBatches + 1, reviewed: status.reviewed + rows.length,
        lastCompletedAt: new Date(startedAt).toISOString(), lastDurationMs: now() - startedAt });
      return { reviewed: rows.length };
    } catch {
      status.failures += 1;
      return { failed: true };
    } finally { running = false; }
  }
  return { run, getStatus: () => ({ ...status, tracked: reviewed.size, running }) };
}
