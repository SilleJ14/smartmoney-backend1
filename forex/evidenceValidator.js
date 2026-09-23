const freeze = (value) => Object.freeze(value);

export const FOREX_EVIDENCE_POLICY_VERSION = "FOREX_EVIDENCE_V1";

const KEYS = [
  "forex:analysis:research",
  "forex:entry:automatic",
  "forex:entry:manual",
  "forex:order:automatic",
  "forex:order:manual",
  "forex:close:automatic",
];

export const FOREX_EVIDENCE_POLICIES = freeze(Object.fromEntries(KEYS.map((key) => {
  const [, stage, intent] = key.split(":");
  const order = stage === "order" || stage === "close";
  return [key, {
    version: FOREX_EVIDENCE_POLICY_VERSION,
    assetClass: "forex",
    decisionStage: stage,
    orderIntent: intent,
    quote: { providerMaxAgeSeconds: 2, transportMaxAgeSeconds: 1 },
    account: { maxAgeSeconds: 5, requireNoTransactionGap: true },
    conversion: { maxAgeSeconds: 2 },
    candles: { requireCompleted: true, pollDeadlineSeconds: 30 },
    calendar: { maxAgeMinutes: 15, requiredForAutomatic: intent === "automatic" && stage !== "close" },
    authorizationExpiresSeconds: 2,
  }];
})));

export function forexEvidencePolicy(assetClass, decisionStage, orderIntent) {
  const policy = FOREX_EVIDENCE_POLICIES[`${assetClass}:${decisionStage}:${orderIntent}`];
  if (!policy) throw new Error("UNKNOWN_EVIDENCE_POLICY");
  return policy;
}

export function stampEvidence({ source, instrument, account, providerTimestamp, payload, qualityStatus = "VALID", revision = 1, now } = {}) {
  const receivedAt = new Date(now || Date.now()).toISOString();
  return {
    source,
    instrument: instrument || null,
    account: account || null,
    providerTimestamp: providerTimestamp || null,
    receivedAt,
    validatedAt: receivedAt,
    qualityStatus,
    revision,
    payload,
  };
}

export function validateQuote(evidence, { now = Date.now(), policy } = {}) {
  const reasons = [];
  const providerAt = Date.parse(evidence?.providerTimestamp || "");
  const receivedAt = Date.parse(evidence?.receivedAt || "");
  if (!Number.isFinite(providerAt)) reasons.push("QUOTE_STALE");
  else if (!Number.isFinite(now) || providerAt > now || now - providerAt > policy.quote.providerMaxAgeSeconds * 1000) reasons.push("QUOTE_STALE");
  if (!Number.isFinite(receivedAt) || receivedAt > now) reasons.push("QUOTE_STALE");
  const bid = Number(evidence?.payload?.bid);
  const ask = Number(evidence?.payload?.ask);
  if (!(bid > 0) || !(ask >= bid) || evidence?.payload?.tradeable === false) reasons.push("QUOTE_INVALID");
  if (Number.isFinite(providerAt) && Number.isFinite(receivedAt) && receivedAt - providerAt > policy.quote.transportMaxAgeSeconds * 1000) {
    reasons.push("QUOTE_STALE");
  }
  return reasons;
}
