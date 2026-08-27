const HORIZONS = [1, 3, 5];
const round = (value, digits = 3) => Number(Number(value || 0).toFixed(digits));

function measuredRows(observations, assetClass, days) {
  return observations
    .filter((item) => item?.assetClass === assetClass)
    .map((item) => ({ item, measurement: item?.measurements?.[days] }))
    .filter(({ measurement }) => Number.isFinite(Number(measurement?.closeReturnPercent)))
    .sort((a, b) => Number(a.item.observedAt || 0) - Number(b.item.observedAt || 0));
}

function maximumDrawdown(returns) {
  let equity = 1, peak = 1, maximum = 0;
  for (const value of returns) {
    equity *= 1 + Number(value) / 100;
    peak = Math.max(peak, equity);
    maximum = Math.max(maximum, peak > 0 ? ((peak - equity) / peak) * 100 : 0);
  }
  return round(maximum);
}

function summarize(rows, { feePercent, slippagePercent, breakoutPercent }) {
  const gross = rows.map(({ measurement }) => Number(measurement.closeReturnPercent));
  const cost = 2 * (feePercent + slippagePercent);
  const net = gross.map((value) => value - cost);
  const wins = net.filter((value) => value > 0), losses = net.filter((value) => value < 0);
  const hits = rows.filter(({ measurement }) => Number(measurement.peakReturnPercent) >= breakoutPercent).length;
  const average = (values) => values.length ? round(values.reduce((sum, value) => sum + value, 0) / values.length) : null;
  return {
    sampleCount: rows.length,
    riseRatePercent: rows.length ? round((gross.filter((value) => value > 0).length / rows.length) * 100, 1) : null,
    falseDiscoveryRatePercent: rows.length ? round(((rows.length - hits) / rows.length) * 100, 1) : null,
    averageGrossReturnPercent: average(gross),
    averageNetReturnPercent: average(net),
    averageProfitPercent: average(wins),
    averageLossPercent: average(losses),
    maximumSequentialDrawdownPercent: rows.length ? maximumDrawdown(net) : null,
    assumedRoundTripCostPercent: round(cost),
  };
}

export function buildProofReport(outcomeState = {}, {
  feePercent = 0.15,
  slippagePercent = 0.1,
  minimumOutOfSample = 30,
  generatedAt = Date.now(),
} = {}) {
  const observations = Array.isArray(outcomeState?.observations) ? outcomeState.observations : [];
  const assets = {};
  for (const assetClass of ["stock", "crypto"]) {
    const breakoutPercent = assetClass === "crypto" ? 10 : 8;
    assets[assetClass] = { breakoutPercent, horizons: {} };
    for (const days of HORIZONS) {
      const rows = measuredRows(observations, assetClass, days);
      const split = Math.floor(rows.length * 0.7);
      const training = rows.slice(0, split), outOfSample = rows.slice(split);
      assets[assetClass].horizons[days] = {
        all: summarize(rows, { feePercent, slippagePercent, breakoutPercent }),
        training: summarize(training, { feePercent, slippagePercent, breakoutPercent }),
        outOfSample: summarize(outOfSample, { feePercent, slippagePercent, breakoutPercent }),
        outOfSampleReady: outOfSample.length >= minimumOutOfSample,
        splitPolicy: "CHRONOLOGICAL_70_30_NO_SHUFFLE",
      };
    }
  }
  const benchmarkSummary = Object.fromEntries(["SPY", "Bitcoin", "simpleMomentum"].map((name) => {
    const horizons = Object.fromEntries(HORIZONS.map((days) => {
      const values = observations
        .map((item) => item?.benchmarkMeasurements?.[days]?.[name])
        .filter((value) => value !== null && value !== undefined && value !== "")
        .map(Number)
        .filter(Number.isFinite);
      return [days, { sampleCount: values.length, averageReturnPercent: values.length
        ? round(values.reduce((sum, value) => sum + value, 0) / values.length)
        : null }];
    }));
    return [name, { status: Object.values(horizons).some((item) => item.sampleCount > 0) ? "MEASURED" : "PENDING_SYNCHRONIZED_FORWARD_SAMPLES", horizons }];
  }));
  return {
    version: 1,
    generatedAt: new Date(generatedAt).toISOString(),
    status: "EVIDENCE_REPORT_NOT_A_PERFORMANCE_GUARANTEE",
    methodology: {
      observationsIncludeUntradedCandidates: true,
      horizons: HORIZONS,
      feesPercentPerSide: feePercent,
      slippagePercentPerSide: slippagePercent,
      minimumOutOfSample,
      drawdownMethod: "SEQUENTIAL_EQUAL_WEIGHT_COMPOUNDED_CANDIDATE_RETURNS",
    },
    assets,
    benchmarks: benchmarkSummary,
    productionClaimApproved: Object.values(assets).every((asset) =>
      HORIZONS.every((days) => asset.horizons[days].outOfSampleReady)
    ),
  };
}
