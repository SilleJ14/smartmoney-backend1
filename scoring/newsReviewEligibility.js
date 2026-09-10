import { calculateEntryQualityScore } from './decisionScores.js';

// Research eligibility is NOT order approval. Only the missing-news requirement
// is excluded from this private preview; the real Entry score is never replaced.
export function evaluateNewsReviewEligibility(quote = {}, quality = {}, enabled = true) {
  if (!enabled) return { eligible: false, reason: 'ADVANCED_FILTERS_DISABLED' };
  // A research-only risk review is also needed for measured watch candidates.
  // The scanner's bounded universe/concurrency and provider caches bound this;
  // this must never clear their existing execution rejection.
  const measuredResearch = Number(quote.price ?? quote.current) > 0 &&
    Number(quote.technicalBarsFound) >= 20 && Number(quote.volume) >= 300000 &&
    (Number(quote.preMoveScore) >= 65 || Number(quote.percentChange) >= 0.25);
  if (measuredResearch && quote.confirmations?.newsRiskAvailable !== true) {
    return { eligible: true, reason: 'MEASURED_CANDIDATE_RISK_RESEARCH' };
  }
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
