// Policy declarations are shared by authorization and diagnostic consumers.
// Research thresholds remain owned by the existing scorers (no new denominator).
export const EVIDENCE_POLICY_VERSION = 'EVIDENCE_V1';
const roles = Object.freeze({ REQUIRED: 'REQUIRED', OPTIONAL: 'OPTIONAL', AUTHORIZATION: 'AUTHORIZATION_ONLY', NONE: 'NOT_APPLICABLE' });
const purchases = ['manual', 'automatic', 'scale_in'];
const stages = ['discovery', 'entry', 'final', 'order'];
const assets = ['stock', 'crypto'];
const freeze = value => { Object.values(value).forEach(v => { if (v && typeof v === 'object') freeze(v); }); return Object.freeze(value); };

export const EVIDENCE_POLICIES = freeze(Object.fromEntries(assets.flatMap(asset => stages.flatMap(stage => purchases.map(purchase => {
  const order = stage === 'order', strategy = purchase !== 'manual';
  return [`${asset}:${stage}:${purchase}`, {
    version: EVIDENCE_POLICY_VERSION, assetClass: asset, decisionStage: stage, purchaseType: purchase,
    evidence: {
      price: order ? roles.AUTHORIZATION : roles.REQUIRED,
      spread: order ? roles.AUTHORIZATION : stage === 'discovery' ? roles.OPTIONAL : roles.REQUIRED,
      history: order ? strategy ? roles.REQUIRED : roles.NONE : roles.REQUIRED,
      technicals: order && !strategy ? roles.NONE : stage === 'discovery' ? roles.OPTIONAL : roles.REQUIRED,
      fundamentals: asset === 'crypto' || (order && !strategy) ? roles.NONE : roles.OPTIONAL,
      news: order && !strategy ? roles.NONE : roles.OPTIONAL,
      account: order ? roles.AUTHORIZATION : roles.NONE,
      safetyLocks: order ? roles.AUTHORIZATION : roles.NONE,
      canonicalDecision: order && strategy ? roles.AUTHORIZATION : roles.NONE,
      orderbook: asset === 'crypto' && order ? roles.AUTHORIZATION : roles.NONE,
    },
    // Required news and portfolio-in-F remain conditional on existing model config.
    conditionalEvidence: { news: 'existing requireNewsRiskForEntry / crypto policy',
      account: 'existing riskPortfolio contribution preserved for stock F' },
    exemptions: order && !strategy ? ['AI_SCORE', 'AI_ENTRY_TRIGGER', 'AUTOPILOT_ENABLED', 'AI_APPROVED_SIZE', 'BOT_ALLOCATION_CAP'] : [],
    requireStrategy: order && strategy, requireAutopilot: order && strategy,
    requireBotCap: order && strategy,
    // Existing execution policy permits up to 5s past / 5s future. No stricter
    // generic technical/history skew is silently added to the scoring baseline.
    executionTime: { maxAgeMs: 5000, maxFutureMs: 5000, maxPriceSpreadSkewMs: 10000 },
    researchTime: { maxCompletedBarIntervalsBehindPrice: 2, allowedIntervalsMs: [60000,300000,900000] },
    dependencies: { technicals: ['validatedBarSnapshotId'] },
  }];
})))));

export function evidencePolicy(assetClass, decisionStage, purchaseType) {
  const policy = EVIDENCE_POLICIES[`${assetClass}:${decisionStage}:${purchaseType}`];
  if (!policy) throw new Error('UNKNOWN_EVIDENCE_POLICY');
  return policy;
}
export function purchasePolicy(options = {}, crypto = false) {
  const purchase = options.automated === false && options.requireCandidateDecision !== true ? 'manual'
    : options.purchaseType === 'scale_in' ? 'scale_in' : 'automatic';
  return evidencePolicy(crypto ? 'crypto' : 'stock', 'order', purchase);
}

export function executionEvidenceIssues({ priceAt, spreadAt, now = Date.now(), policy }) {
  const reasons = [];
  const limits = policy.executionTime;
  for (const [name, at] of [['PRICE', priceAt], ['SPREAD', spreadAt]]) {
    if (!Number.isFinite(at) || at <= 0) reasons.push(`${name}_TIMESTAMP_MISSING`);
    else if (at > now + limits.maxFutureMs) reasons.push(`${name}_TIMESTAMP_FUTURE`);
    else if (now - at > limits.maxAgeMs) reasons.push(`${name}_EVIDENCE_STALE`);
  }
  if (Number.isFinite(priceAt) && Number.isFinite(spreadAt) && Math.abs(priceAt - spreadAt) > limits.maxPriceSpreadSkewMs) reasons.push('EVIDENCE_SKEW_EXCEEDED');
  return reasons;
}

export function researchExecutionIssues(signal, policy) {
  if(!policy.requireStrategy)return [];
  // Rollout compatibility: historical decisions retain their existing gates.
  // All new central decisions carry EVIDENCE_V1 and must provide this provenance.
  if(signal.decisionProvenance?.evidencePolicyVersion!==EVIDENCE_POLICY_VERSION)return [];
  const crypto=policy.assetClass==='crypto';
  const priceAt=Date.parse(signal.liveQuoteUpdatedAt || '');
  const interval=crypto ? Number(signal.cryptoSetup?.timeframeMinutes)*60000 : Number(signal.technicals?.intervalMs);
  const last=Date.parse(crypto ? signal.cryptoSetup?.barUpdatedAt || '' : signal.technicals?.lastBarAt || '');
  if(!Number.isFinite(priceAt)||!Number.isFinite(last)||!policy.researchTime.allowedIntervalsMs.includes(interval))return ['TECHNICAL_EXECUTION_TIME_UNAVAILABLE'];
  const completedAt=crypto ? last : last+interval;
  if(completedAt>priceAt+policy.executionTime.maxFutureMs)return ['TECHNICAL_EVIDENCE_AFTER_PRICE'];
  return priceAt-completedAt>interval*policy.researchTime.maxCompletedBarIntervalsBehindPrice ? ['PRICE_TECHNICAL_SKEW_EXCEEDED'] : [];
}
