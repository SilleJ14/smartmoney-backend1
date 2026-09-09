import { calculateEntryQualityScore } from './decisionScores.js';

// Research eligibility is NOT order approval. Only the missing-news requirement
// is excluded from this private preview; the real Entry score is never replaced.
export function evaluateNewsReviewEligibility(quote = {}, quality = {}, enabled = true) {
  if (!enabled) return { eligible: false, reason: 'ADVANCED_FILTERS_DISABLED' };
  if (quality.discoveryOnly === true || quote.blockBuying === true || quote.buyBlocked === true) {
    return { eligible: false, reason: 'EXISTING_BUY_BLOCK' };
  }
  const preview = calculateEntryQualityScore({ ...quote, requireNewsRiskForEntry: false });
  if (preview.gates.includes('HARD_RISK_REJECT') || quote.setupRevalidationRequired === true) {
    return { eligible: false, reason: 'INDEPENDENT_ENTRY_RISK' };
  }
  const entryShortlist = Number.isFinite(preview.score) && preview.score >= 60;
  const discoveryShortlist = Number(quote.discoveryScore || 0) >= 70 || Number(quote.preMoveScore || 0) >= 70;
  return {
    eligible: entryShortlist || discoveryShortlist,
    reason: entryShortlist ? 'ENTRY_RESEARCH_SHORTLIST' : discoveryShortlist ? 'DISCOVERY_RESEARCH_SHORTLIST' : 'SHORTLIST_NOT_REACHED',
  };
}
