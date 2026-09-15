// Classify urgency only. Never calculate a score or confer trading permission.
export function reassessmentTrigger(row) {
  if (!row || typeof row !== 'object') return row;
  const crypto = String(row.symbol || '').includes('/');
  const final = crypto ? row.cryptoDecisionScore : row.stockDecisionScore;
  const threshold = crypto ? 65 : 78;
  const near = typeof final === 'number' && final >= threshold - 5;
  const held = row.isHeldPosition === true;
  const price = Number(row.price || row.current), reference = Number(row.decisionReferencePrice);
  const moved = reference > 0 && price > 0 && Math.abs(price / reference - 1) >= 0.02;
  const quoteReady = row.liveQuoteFresh === true && row.liveSpreadFresh === true;
  const missingEntry = crypto ? row.cryptoEntryScoreAvailable === false : row.entryQualityScoreAvailable === false;
  const event = moved ? `price:${Math.floor(price / reference * 50)}` :
    quoteReady && missingEntry ? `evidence:${row.decisionUpdatedAt || 'new'}` : null;
  return { ...row, reassessmentPriority: Math.max(Number(row.reassessmentPriority) || 0, held ? 3 : moved || near ? 2 : 0),
    ...(event && !row.reassessmentEvent ? { reassessmentEvent: event } : {}) };
}
