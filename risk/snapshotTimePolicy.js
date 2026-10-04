import { cryptoQuoteTop, effectiveCryptoEvidenceAtMs } from '../scoring/cryptoReferenceVerification.js';
// Authorization coherence, not a replacement score formula. Slow evidence has
// its own clock; a receipt timestamp never substitutes for a provider quote.
export const SNAPSHOT_TIME_POLICY_VERSION = 'SNAPSHOT_TIME_V1';
export const SNAPSHOT_TIME_RULES = Object.freeze({
  price: { maxAgeMs: 5000, maxFutureMs: 5000 },
  spread: { maxAgeMs: 5000, maxFutureMs: 5000 },
  newsReview: { maxAgeMs: 15 * 60000, maxFutureMs: 5000 },
  newsPublication: { maxAgeMs: 72 * 3600000, maxFutureMs: 3600000 },
  fundamentals: { maxAgeMs: 120 * 86400000, maxFutureMs: 86400000 },
  stockContext: { maxAgeMs: 60000, maxFutureMs: 5000 },
  cryptoContext: { maxAgeMs: 15 * 60000, maxFutureMs: 5000 },
  account: { maxAgeMs: 10000, maxFutureMs: 5000 },
});
const timestamp = value => {
  const at = value == null || value === '' ? NaN : typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(at) && Math.abs(at) <= 8640000000000000 ? at : NaN;
};
export function assessSnapshotTimes(signal, { crypto = false, now = Date.now() } = {}) {
  const fields = {}, blockers = [];
  // Crypto only: a fresh reference verification covering the exact Alpaca
  // provider time proves a quiet price/spread is current as of verifiedAt.
  // The provider time is still reported; only the evaluated time changes.
  // Coverage is bound to the signal's own bid/ask, and the evaluated time is
  // never older than the provider time itself.
  const verification = crypto ? signal.cryptoReferenceVerification : null;
  const top = cryptoQuoteTop(signal);
  const effective = (raw, kind) => {
    const at = timestamp(raw);
    return crypto && Number.isFinite(at)
      ? effectiveCryptoEvidenceAtMs({ providerAtMs: at, verification, now, symbol: signal.symbol, ...top, kind })
      : at;
  };
  const priceAt = effective(signal.liveQuoteUpdatedAt, 'quote');
  function assess(name, raw, used, rule, evaluatedAt = timestamp(raw)) {
    const at = evaluatedAt, ageMs = now - at;
    const skewMs = Number.isFinite(priceAt) && Number.isFinite(at) ? priceAt - at : null;
    const status = !Number.isFinite(at) ? 'UNAVAILABLE' : ageMs < -rule.maxFutureMs ? 'FUTURE'
      : ageMs > rule.maxAgeMs ? 'STALE' : skewMs !== null && (skewMs > rule.maxAgeMs || skewMs < -rule.maxFutureMs) ? 'INCOHERENT' : 'COHERENT';
    const providerAt = timestamp(raw);
    fields[name] = { status, used, observedAt: Number.isFinite(providerAt) ? new Date(providerAt).toISOString() : null,
      ageMs: Number.isFinite(ageMs) ? ageMs : null, skewFromPriceMs: skewMs, ...rule,
      ...(Number.isFinite(at) && Number.isFinite(providerAt) && at !== providerAt
        ? { referenceVerifiedAt: new Date(at).toISOString() } : {}) };
    if (used && status !== 'COHERENT') blockers.push(`${name.toUpperCase()}_EVIDENCE_${status}`);
  }
  assess('price', signal.liveQuoteUpdatedAt, true, SNAPSHOT_TIME_RULES.price, priceAt);
  const spreadRaw = signal.spreadUpdatedAt ?? signal.bidAskUpdatedAt;
  assess('spread', spreadRaw, true, SNAPSHOT_TIME_RULES.spread, effective(spreadRaw, 'spread'));
  const confirmations = signal.confirmations || {};
  assess('newsReview', confirmations.newsReviewedAt ?? confirmations.newsReviewCoverage?.checkedAt ?? signal.newsRiskCheckedAt,
    signal.requireNewsRiskForEntry === true && confirmations.newsRiskAvailable === true, SNAPSHOT_TIME_RULES.newsReview);
  const catalyst = signal.newsCatalyst ?? confirmations.newsCatalyst;
  const usesCatalyst = catalyst?.catalystAvailable === true;
  assess('oldestNewsPublication', catalyst?.publicationWindow?.oldestAt, usesCatalyst, SNAPSHOT_TIME_RULES.newsPublication);
  assess('newestNewsPublication', catalyst?.publicationWindow?.newestAt, usesCatalyst, SNAPSHOT_TIME_RULES.newsPublication);
  assess('fundamentals', signal.fundamentalValidation?.asOf ?? signal.fundamentals?.asOf ?? signal.fundamentalsUpdatedAt,
    !crypto && signal.fundamentalDataValid === true, SNAPSHOT_TIME_RULES.fundamentals);
  if (crypto) assess('cryptoContext', signal.cryptoContextScorecard?.calculatedAt,
    signal.cryptoContextScorecard?.independent === true, SNAPSHOT_TIME_RULES.cryptoContext);
  else {
    const context = signal.marketContextEvidence;
    const observations = Array.isArray(context?.observations) ? context.observations : [];
    const times = observations.map(row => timestamp(row?.quoteAt)).filter(Number.isFinite);
    assess('stockContext', times.length ? Math.min(...times) : null,
      context?.available === true, SNAPSHOT_TIME_RULES.stockContext);
  }
  // Technical/bar interval coherence remains enforced by the existing
  // per-asset researchExecutionIssues rule; account is checked at submission.
  return { version: SNAPSHOT_TIME_POLICY_VERSION, evaluatedAt: new Date(now).toISOString(), fields, blockers,
    technicalPolicy: 'SUPPORTED_COMPLETED_BAR_INTERVALS', accountPolicy: 'SUBMISSION_TIME_ONLY',
    newsPublicationPolicy: SNAPSHOT_TIME_RULES.newsPublication };
}
