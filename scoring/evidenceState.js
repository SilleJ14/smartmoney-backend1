// Missing evidence changes availability. Measured bad evidence changes quality.
// A reject belongs to one layer and does not rewrite another layer's score.

export const LAYER_OWNERS = Object.freeze([
  "ANALYTICAL",
  "EVIDENCE",
  "EXECUTION",
  "RISK",
  "AUTHORIZATION",
]);

export const EVIDENCE_STATES = Object.freeze([
  "PASS",
  "WAIT",
  "DATA_UNAVAILABLE",
  "RESCORE_REQUIRED",
  "REJECT",
]);

const STATE_RANK = Object.freeze({
  PASS: 0,
  WAIT: 1,
  DATA_UNAVAILABLE: 2,
  RESCORE_REQUIRED: 3,
  REJECT: 4,
});

export function dominantState(states = []) {
  return states.reduce((best, state) => (
    (STATE_RANK[state] ?? 0) > (STATE_RANK[best] ?? 0) ? state : best
  ), "PASS");
}

export function settleLayer(owner, findings = []) {
  const present = findings.filter((item) => item && item.reason);
  const ordered = [...present].sort((left, right) => (STATE_RANK[right.state] ?? 0) - (STATE_RANK[left.state] ?? 0));
  return {
    owner,
    state: ordered.length ? ordered[0].state : "PASS",
    reasons: ordered.map((item) => item.reason),
  };
}

export function assessShareVolume(quote = {}) {
  if (quote.volumeAvailable === false || quote.shareVolumeAvailable === false) {
    return volumeUnavailable("VOLUME_EXPLICITLY_UNAVAILABLE");
  }
  const raw = quote.shareVolume !== undefined ? quote.shareVolume : quote.volume;
  if (raw === null || raw === undefined || raw === "") return volumeUnavailable("PROVIDER_DID_NOT_RETURN_VOLUME");
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return volumeUnavailable("PROVIDER_DID_NOT_RETURN_VOLUME");
  const poor = value === 0;
  return {
    name: "STOCK_VOLUME",
    state: poor ? "REJECT" : "PASS",
    value,
    score: poor ? 0 : null,
    coverage: 1,
    reason: poor ? "MEASURED_ZERO_VOLUME" : null,
    source: quote.volumeSource || quote.liveQuoteSource || quote.source || null,
    measuredAt: quote.volumeMeasuredAt || quote.liveQuoteUpdatedAt || null,
    measured: true,
  };
}

function volumeUnavailable(reason) {
  return {
    name: "STOCK_VOLUME",
    state: "DATA_UNAVAILABLE",
    value: null,
    score: null,
    coverage: 0,
    reason,
    source: null,
    measuredAt: null,
    measured: false,
  };
}

export function liquidityFromShareVolume(volume, { minimumShares = 0, dollarVolume = null } = {}) {
  if (!volume?.measured) {
    return {
      liquidityStabilityScore: null,
      liquidityMeasured: false,
      hardReject: false,
      state: "DATA_UNAVAILABLE",
    };
  }
  const shares = volume.value;
  const dollars = Number(dollarVolume);
  const dollarMeasured = Number.isFinite(dollars) && dollars >= 0;
  const liquidityStabilityScore = Math.max(0, Math.min(100,
    30
    + (shares >= minimumShares ? 15 : -15)
    + (shares >= 250000 ? 15 : 0)
    + (shares >= 1000000 ? 15 : 0)
    + (dollarMeasured && dollars >= 1000000 ? 15 : 0)
  ));
  return {
    liquidityStabilityScore,
    liquidityMeasured: true,
    hardReject: liquidityStabilityScore <= 18,
    state: liquidityStabilityScore <= 18 ? "REJECT" : "PASS",
  };
}
