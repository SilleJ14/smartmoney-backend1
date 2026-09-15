// Display-only evidence history. Never feeds canonical scores or authorization.
export function retainMeasuredStockScores(signal, previous = {}, now = Date.now()) {
  if (String(signal.symbol || '').includes('/')) return signal;
  const history = {};
  for (const source of [previous.measuredScoreHistory, signal.measuredScoreHistory]) {
    for (const key of ['discovery', 'entry', 'final', 'continuation']) {
      const saved = source?.[key];
      if (typeof saved?.value === 'number' && Number.isFinite(saved.value) && saved.value >= 0 && saved.value <= 100 &&
          Number.isFinite(Date.parse(saved.at)) && Date.parse(saved.at) <= now + 5000 &&
          (!history[key] || Date.parse(saved.at) > Date.parse(history[key].at))) history[key] = saved;
    }
  }
  const at = signal.scoreAssessmentUpdatedAt || signal.decisionUpdatedAt;
  const age = now - Date.parse(at || '');
  if (Number.isFinite(age) && age >= -5000 && age <= 300000) {
    const fields = {
      discovery: [signal.discoveryScore ?? signal.discoveryScorecard?.score, signal.discoveryScoreAvailable === true ||
        (signal.discoveryScoreAvailable !== false && signal.discoveryScorecard?.coverage >= 0.65 && signal.discoveryScorecard?.canonicalExtensionEvidencePass === true)],
      entry: [signal.entryQualityScore ?? signal.entryQualityScorecard?.score, signal.entryQualityScoreAvailable === true],
      final: [signal.stockDecisionScore, signal.stockDecisionScoreAvailable === true],
      continuation: [signal.multiDayContinuationScore ?? signal.multiDayScore, signal.multiDayScoreAvailable === true],
    };
    for (const [key, [value, available]] of Object.entries(fields)) {
      if (available && typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100 &&
          (!history[key] || Date.parse(at) >= Date.parse(history[key].at))) history[key] = { value, at };
    }
  }
  signal.measuredScoreHistory = history;
  return signal;
}
