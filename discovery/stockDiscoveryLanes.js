function finite(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function classifyStockDiscoveryLane(
  candidate = {},
  { minScanVolume = 300_000 } = {}
) {
  const volume = finite(candidate.volume || candidate.barVolume);
  const relativeVolume = finite(
    candidate.relativeVolume ||
    candidate.volumeRatio ||
    candidate.volumeSpikeRatio ||
    candidate.confirmations?.volumeSpikeRatio
  );
  const percentChange = finite(candidate.percentChange);
  const preMoveScore = finite(candidate.preMoveScore);
  const ema9 = finite(candidate.technicals?.ema9);
  const ema20 = finite(candidate.technicals?.ema20);
  const hasMomentum =
    percentChange > 0 ||
    finite(candidate.momentumScore) >= 60 ||
    finite(candidate.breakoutScore) >= 60 ||
    ["IGNITION", "EXPANSION"].includes(String(candidate.runnerStage || "").toUpperCase()) ||
    candidate.confirmations?.volumeSpike === true;
  const hasMeasuredStructure =
    candidate.confirmations?.aboveVwap === true ||
    candidate.confirmations?.closeNearHigh === true ||
    (ema9 > 0 && ema20 > 0 && ema9 > ema20) ||
    preMoveScore >= 58;
  const normalStrong =
    volume >= Number(minScanVolume || 300_000) &&
    percentChange >= 0.25 &&
    percentChange <= 15 &&
    hasMomentum &&
    hasMeasuredStructure &&
    (
      relativeVolume >= 1.2 ||
      volume >= Number(minScanVolume || 300_000) * 2
    );

  return {
    lane: normalStrong ? "NORMAL_STRONG" : "EXPLOSIVE_RUNNER",
    normalStrong,
    evidence: {
      volume,
      relativeVolume,
      percentChange,
      hasMomentum,
      hasMeasuredStructure,
    },
  };
}
