// Diagnostics never authorize orders. They describe the final published cycle.
export function forexDecisionDiagnostics(snapshot, instruments = []) {
  const globalBlockers = [...new Set([
    ...(snapshot.halt && snapshot.halt !== 'CLEAR' ? [snapshot.halt] : []),
    ...(snapshot.lastError ? ['SCAN_FAILED'] : []),
    ...(snapshot.forexAutoEnabled === false ? ['FOREX_AUTOPILOT_OFF'] : []),
    ...(snapshot.forexEmergencyStopActive ? ['FOREX_EMERGENCY_STOP'] : []),
    ...(snapshot.executionMode === 'ANALYSIS_ONLY' ? ['ORDER_SUBMISSION_DISABLED'] : []),
  ])];
  const rows = snapshot.candidates || [];
  const pairs = [...new Set([...instruments, ...rows.map(r => r.instrument)])].map(instrument => {
    const evaluations = rows.filter(r => r.instrument === instrument).map(r => ({
      strategyId: r.strategyId, side: r.side, state: r.state,
      reason: r.lastReason || 'UNKNOWN',
      blockers: [...new Set([...(r.blockers || []), ...globalBlockers])],
      pending: r.pending || [],
      entryPermission: r.entryPermission || null,
    }));
    return { instrument, evaluations, outcome: evaluations.length ? 'EVALUATED' : 'NOT_EVALUATED',
      blockers: evaluations.length ? [] : (globalBlockers.length ? globalBlockers : ['NO_EVALUATION']) };
  });
  const reasonCounts = {};
  for (const pair of pairs) {
    const reasons = new Set([...pair.blockers, ...pair.evaluations.flatMap(r => [...r.blockers, r.reason])]);
    for (const reason of reasons) reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
  }
  return { observedAt: snapshot.lastCycleAt, globalBlockers, pairs, reasonCounts,
    readyPairs: (snapshot.signals || []).filter(r => r.forexState === 'ready').map(r => r.instrument),
    lastOrder: snapshot.lastPracticeOrder ? {
      ok: snapshot.lastPracticeOrder.ok === true, state: snapshot.lastPracticeOrder.state || null,
      reason: snapshot.lastPracticeOrder.reason || null,
    } : null };
}

export function blockForexCandidates(candidates, reasons) {
  const blockers = [...new Set(reasons.filter(Boolean))];
  if (!blockers.length) return;
  for (const row of candidates) {
    row.blockers = [...new Set([...(row.blockers || []), ...blockers])];
    if (row.state === 'EXECUTION_ELIGIBLE') {
      row.state = 'BLOCKED';
      row.lastReason = blockers[0];
      row.executionAuthorization = 'None';
    }
  }
}
