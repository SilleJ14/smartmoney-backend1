function clampScore(value) {
  return Math.max(0, Math.min(100, Number(value) || 0));
}

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
  const coverageReady = sampleSize >= Math.max(2, Number(minimumSampleSize) || 5);
  const breadthRatio = sampleSize > 0 ? positiveCount / sampleSize : 0;
  const averagePeerChange = sampleSize > 0
    ? measuredChanges.reduce((sum, value) => sum + value, 0) / sampleSize
    : 0;
  return {
    independent: coverageReady,
    score: clampScore(35 + breadthRatio * 50),
    coverage: coverageReady ? 1 : 0,
    source: "leave_one_out_crypto_market_breadth",
    sampleSize,
    positiveCount,
    breadthRatio: Number(breadthRatio.toFixed(4)),
    averagePeerChange: Number(averagePeerChange.toFixed(4)),
    calculatedAt: now().toISOString(),
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
    lastScorecard = scorecard;
  }
  return lastScorecard;
}
