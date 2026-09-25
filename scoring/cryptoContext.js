// Leave-one-out breadth. Five peers are required. The score can only land
// between 35 and 85. It never enters analytical F.
export const CRYPTO_BREADTH_RANGE = Object.freeze({
  minimumPeerCount: 5,
  minimumMeasuredScore: 35,
  maximumMeasuredScore: 85,
  scoreAtZeroBreadth: 35,
  scorePerUnitBreadth: 50,
  weakBelowBreadth: 1 / 3,
  strongAboveBreadth: 2 / 3,
  weakSizeMultiplier: 0.5,
  fullSizeMultiplier: 1,
});

function finiteNumber(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function resolvePeerChange(signal = {}) {
  return finiteNumber(
    signal.dayChangePercent,
    signal.percentChange,
    signal.changePercent,
    signal.sessionChangePercent
  );
}

export function buildCrossAssetCryptoContextScorecard(
  { peerChanges = [] } = {},
  { now = () => new Date(), minimumSampleSize = 5 } = {}
) {
  const measuredChanges = (Array.isArray(peerChanges) ? peerChanges : [])
    .map(Number)
    .filter(Number.isFinite);
  const sampleSize = measuredChanges.length;
  const positiveCount = measuredChanges.filter((value) => value > 0).length;
  const requiredPeers = Math.max(CRYPTO_BREADTH_RANGE.minimumPeerCount, Number(minimumSampleSize) || 5);
  const coverageReady = sampleSize >= requiredPeers;
  const breadthRatio = sampleSize > 0 ? positiveCount / sampleSize : null;
  const averagePeerChange = sampleSize > 0
    ? measuredChanges.reduce((sum, value) => sum + value, 0) / sampleSize
    : null;
  const measuredAt = now().toISOString();
  const context = buildCryptoMarketContext({
    peerChanges: measuredChanges,
    measuredAt,
    minimumSampleSize: requiredPeers,
  });
  return {
    ...context,
    independent: coverageReady,
    coverage: coverageReady ? 1 : 0,
    source: "leave_one_out_crypto_market_breadth",
    sampleSize,
    positiveCount,
    breadthRatio: breadthRatio === null ? null : Number(breadthRatio.toFixed(4)),
    averagePeerChange: averagePeerChange === null ? null : Number(averagePeerChange.toFixed(4)),
    calculatedAt: measuredAt,
  };
}

export function buildCryptoMarketContext({
  peerChanges = [],
  measuredAt = null,
  minimumSampleSize = CRYPTO_BREADTH_RANGE.minimumPeerCount,
} = {}) {
  const measuredChanges = (Array.isArray(peerChanges) ? peerChanges : [])
    .map(Number)
    .filter(Number.isFinite);
  const peersMeasured = measuredChanges.length;
  const peersUp = measuredChanges.filter((value) => value > 0).length;
  const requiredPeers = Math.max(CRYPTO_BREADTH_RANGE.minimumPeerCount, Number(minimumSampleSize) || 5);
  if (peersMeasured < requiredPeers) {
    return {
      score: null,
      state: "DATA_UNAVAILABLE",
      peersMeasured,
      peersUp,
      breadthPct: null,
      measuredAt,
      affectsF: false,
      minimumMeasuredScore: CRYPTO_BREADTH_RANGE.minimumMeasuredScore,
      maximumMeasuredScore: CRYPTO_BREADTH_RANGE.maximumMeasuredScore,
      minimumPeerCount: requiredPeers,
    };
  }
  const breadthRatio = peersUp / peersMeasured;
  const score = Number((
    CRYPTO_BREADTH_RANGE.scoreAtZeroBreadth
    + breadthRatio * CRYPTO_BREADTH_RANGE.scorePerUnitBreadth
  ).toFixed(2));
  const state = breadthRatio < CRYPTO_BREADTH_RANGE.weakBelowBreadth
    ? "WEAK"
    : breadthRatio > CRYPTO_BREADTH_RANGE.strongAboveBreadth
      ? "STRONG"
      : "PASS";
  return {
    score,
    state,
    peersMeasured,
    peersUp,
    breadthPct: Number((breadthRatio * 100).toFixed(1)),
    measuredAt,
    affectsF: false,
    minimumMeasuredScore: CRYPTO_BREADTH_RANGE.minimumMeasuredScore,
    maximumMeasuredScore: CRYPTO_BREADTH_RANGE.maximumMeasuredScore,
    minimumPeerCount: requiredPeers,
  };
}

export function cryptoBreadthRiskAndSize(context = {}) {
  if (!context || context.state === "DATA_UNAVAILABLE" || context.score === null || context.score === undefined) {
    return {
      R: { state: "WAIT", reason: "CRYPTO_BREADTH_UNAVAILABLE", hardReject: null },
      S: { regimeMultiplier: null, posture: "CONSERVATIVE_UNTIL_MEASURED", productionEffect: true },
    };
  }
  if (context.state === "WEAK") {
    return {
      R: { state: "PASS_WITH_CONSTRAINT", reason: "WEAK_CRYPTO_BREADTH", hardReject: null },
      S: { regimeMultiplier: CRYPTO_BREADTH_RANGE.weakSizeMultiplier, posture: "REDUCED", productionEffect: true },
    };
  }
  if (context.state === "STRONG") {
    return {
      R: { state: "PASS", posture: "FAVORABLE", reason: "STRONG_CRYPTO_BREADTH", hardReject: null },
      S: { regimeMultiplier: CRYPTO_BREADTH_RANGE.fullSizeMultiplier, posture: "FULL", productionEffect: true },
    };
  }
  return {
    R: { state: "PASS", posture: "NEUTRAL", reason: null, hardReject: null },
    S: { regimeMultiplier: CRYPTO_BREADTH_RANGE.fullSizeMultiplier, posture: "FULL", productionEffect: true },
  };
}

export function applyCrossAssetCryptoContext(
  signals = [],
  _state = {},
  options = {}
) {
  const candidates = Array.isArray(signals) ? signals : [];
  let lastScorecard = buildCrossAssetCryptoContextScorecard({}, options);
  for (let index = 0; index < candidates.length; index += 1) {
    const signal = candidates[index];
    if (!signal || typeof signal !== "object") continue;
    const peerChanges = candidates
      .filter((peer, peerIndex) => peerIndex !== index && peer && typeof peer === "object")
      .map(resolvePeerChange)
      .filter((value) => value !== undefined);
    const scorecard = buildCrossAssetCryptoContextScorecard(
      { peerChanges },
      options
    );
    signal.cryptoContextScorecard = scorecard;
    signal.cryptoMarketContext = scorecard;
    lastScorecard = scorecard;
  }
  return lastScorecard;
}
