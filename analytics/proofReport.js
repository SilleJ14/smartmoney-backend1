const HORIZONS = [1, 3, 5];
const DAY_MS = 24 * 60 * 60 * 1000;
const round = (value, digits = 3) => Number(Number(value || 0).toFixed(digits));

function measuredRows(observations, assetClass, days) {
  return observations
    .filter((item) => item?.assetClass === assetClass)
    .map((item) => ({ item, measurement: item?.measurements?.[days], days }))
    .filter(({ measurement }) =>
      measurement?.closeReturnPercent !== null &&
      measurement?.closeReturnPercent !== undefined &&
      measurement?.closeReturnPercent !== "" &&
      Number.isFinite(Number(measurement.closeReturnPercent))
    )
    .sort((a, b) => Number(a.item.observedAt || 0) - Number(b.item.observedAt || 0));
}

function average(values) {
  return values.length
    ? values.reduce((sum, value) => sum + Number(value), 0) / values.length
    : null;
}

function meanConfidence95(values) {
  if (!values.length) return { low: null, high: null, standardError: null };
  const mean = average(values);
  if (values.length < 2) {
    return { low: round(mean), high: round(mean), standardError: null };
  }
  const variance = values.reduce(
    (sum, value) => sum + (Number(value) - mean) ** 2,
    0
  ) / (values.length - 1);
  const standardError = Math.sqrt(variance / values.length);
  return {
    low: round(mean - 1.96 * standardError),
    high: round(mean + 1.96 * standardError),
    standardError: round(standardError),
  };
}

function wilson95(successes, total) {
  if (!total) return { low: null, high: null };
  const z = 1.96;
  const proportion = successes / total;
  const denominator = 1 + (z * z) / total;
  const center = (proportion + (z * z) / (2 * total)) / denominator;
  const margin = z * Math.sqrt(
    (proportion * (1 - proportion) / total) +
    (z * z) / (4 * total * total)
  ) / denominator;
  return {
    low: round(Math.max(0, center - margin) * 100, 1),
    high: round(Math.min(1, center + margin) * 100, 1),
  };
}

function maximumDrawdown(returns) {
  let equity = 1;
  let peak = 1;
  let maximum = 0;
  for (const value of returns) {
    equity *= 1 + Number(value) / 100;
    peak = Math.max(peak, equity);
    maximum = Math.max(maximum, peak > 0 ? ((peak - equity) / peak) * 100 : 0);
  }
  return round(maximum);
}

function cohortReturns(rows, netReturns) {
  const cohorts = new Map();
  rows.forEach(({ item }, index) => {
    const observedAt = Number(item?.observedAt || 0);
    const key = item?.observedDay || (
      Number.isFinite(observedAt) && observedAt > 0
        ? new Date(observedAt).toISOString().slice(0, 10)
        : `unknown-${index}`
    );
    const values = cohorts.get(key) || [];
    values.push(netReturns[index]);
    cohorts.set(key, values);
  });
  return [...cohorts.entries()]
    .sort(([a], [b]) => String(a).localeCompare(String(b)))
    .map(([, values]) => average(values));
}

function summarize(rows, { feePercent, slippagePercent, breakoutPercent }) {
  const gross = rows.map(({ measurement }) => Number(measurement.closeReturnPercent));
  const cost = 2 * (feePercent + slippagePercent);
  const net = gross.map((value) => value - cost);
  const wins = net.filter((value) => value > 0);
  const losses = net.filter((value) => value < 0);
  const riseCount = gross.filter((value) => value > 0).length;
  const hits = rows.filter(
    ({ measurement }) => Number(measurement.peakReturnPercent) >= breakoutPercent
  ).length;
  const cohortNet = cohortReturns(rows, net);
  return {
    sampleCount: rows.length,
    independentCohortCount: cohortNet.length,
    riseRatePercent: rows.length ? round((riseCount / rows.length) * 100, 1) : null,
    riseRateConfidence95Percent: wilson95(riseCount, rows.length),
    falseDiscoveryRatePercent: rows.length
      ? round(((rows.length - hits) / rows.length) * 100, 1)
      : null,
    averageGrossReturnPercent: average(gross) === null ? null : round(average(gross)),
    averageNetReturnPercent: average(net) === null ? null : round(average(net)),
    averageNetReturnConfidence95Percent: meanConfidence95(net),
    averageProfitPercent: average(wins) === null ? null : round(average(wins)),
    averageLossPercent: average(losses) === null ? null : round(average(losses)),
    maximumCandidateCohortDrawdownPercent: rows.length
      ? maximumDrawdown(cohortNet)
      : null,
    maximumSequentialDrawdownPercent: rows.length
      ? maximumDrawdown(cohortNet)
      : null,
    assumedRoundTripCostPercent: round(cost),
  };
}

function summarizeSegments(rows, key, options) {
  const groups = new Map();
  for (const row of rows) {
    const value = String(row.item?.[key] || "UNKNOWN").toUpperCase();
    const group = groups.get(value) || [];
    group.push(row);
    groups.set(value, group);
  }
  return Object.fromEntries(
    [...groups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, group]) => [name, summarize(group, options)])
  );
}

function scoreReliabilityBands(rows, options) {
  const groups = new Map();
  for (const row of rows) {
    const score = Number(row.item?.discoveryScore);
    if (!Number.isFinite(score)) continue;
    const floor = Math.max(0, Math.min(90, Math.floor(score / 10) * 10));
    const label = `${floor}-${floor + 9}`;
    const group = groups.get(label) || [];
    group.push(row);
    groups.set(label, group);
  }
  return Object.fromEntries(
    [...groups.entries()]
      .sort(([a], [b]) => Number(a.split("-")[0]) - Number(b.split("-")[0]))
      .map(([label, group]) => [label, {
        averageDiscoveryScore: round(average(group.map((row) => row.item.discoveryScore)), 2),
        ...summarize(group, options),
      }])
  );
}

function selectNonOverlappingPerSymbol(rows, horizonDays) {
  const lastBySymbol = new Map();
  return rows.filter(({ item }) => {
    const symbol = String(item?.symbol || "").toUpperCase();
    if (!symbol) return true;
    const observedAt = Number(item?.observedAt || 0);
    const previous = lastBySymbol.get(symbol);
    if (previous !== undefined && observedAt - previous < horizonDays * DAY_MS) {
      return false;
    }
    lastBySymbol.set(symbol, observedAt);
    return true;
  });
}

function walkForwardSplit(rows, { days, minimumTrainingSamples, purgeDays }) {
  const training = rows.slice(0, minimumTrainingSamples);
  if (training.length < minimumTrainingSamples) {
    return { training, outOfSample: [], purgedCount: 0, cutoffAt: null };
  }
  const cutoffAt = Number(training.at(-1)?.item?.observedAt || 0);
  const purgeMs = Math.max(days, purgeDays) * DAY_MS;
  const candidates = rows.slice(minimumTrainingSamples);
  const purged = candidates.filter(
    ({ item }) => Number(item?.observedAt || 0) > cutoffAt + purgeMs
  );
  return {
    training,
    outOfSample: selectNonOverlappingPerSymbol(purged, days),
    purgedCount: candidates.length - purged.length,
    cutoffAt: cutoffAt > 0 ? new Date(cutoffAt).toISOString() : null,
  };
}

function matchedBenchmarkSummary(rows, name, cost) {
  const matched = rows
    .map((row) => {
      const rawBenchmark = row.item?.benchmarkMeasurements?.[row.days]?.[name];
      return {
        candidate: Number(row.measurement.closeReturnPercent) - cost,
        benchmark:
          rawBenchmark === null || rawBenchmark === undefined || rawBenchmark === ""
            ? null
            : Number(rawBenchmark),
      };
    })
    .filter((row) => row.benchmark !== null && Number.isFinite(row.benchmark));
  const benchmarkNet = matched.map((row) => row.benchmark - cost);
  const excess = matched.map((row, index) => row.candidate - benchmarkNet[index]);
  return {
    sampleCount: matched.length,
    averageNetReturnPercent: average(benchmarkNet) === null
      ? null
      : round(average(benchmarkNet)),
    averageExcessReturnPercent: average(excess) === null
      ? null
      : round(average(excess)),
    excessReturnConfidence95Percent: meanConfidence95(excess),
  };
}

function assessProductionReadiness({
  assetClass,
  outOfSample,
  matchedBenchmarks,
  rows,
  minimumOutOfSample,
  maximumAllowedDrawdownPercent,
}) {
  const primaryBenchmark = assetClass === "stock" ? "SPY" : "Bitcoin";
  const primary = matchedBenchmarks[primaryBenchmark];
  const momentum = matchedBenchmarks.simpleMomentum;
  const modelVersions = [...new Set(rows.map(({ item }) =>
    String(item?.scoringModelVersion || "UNVERSIONED")
  ))].sort();
  const checks = {
    minimumSampleCount: outOfSample.sampleCount >= minimumOutOfSample,
    positiveNetReturn: Number(outOfSample.averageNetReturnPercent) > 0,
    netReturnConfidenceAboveZero:
      Number(outOfSample.averageNetReturnConfidence95Percent?.low) > 0,
    boundedCandidateCohortDrawdown:
      Number.isFinite(Number(outOfSample.maximumCandidateCohortDrawdownPercent)) &&
      Number(outOfSample.maximumCandidateCohortDrawdownPercent) <= maximumAllowedDrawdownPercent,
    primaryBenchmarkFullyMatched: primary.sampleCount >= minimumOutOfSample,
    primaryBenchmarkExcessConfidenceAboveZero:
      Number(primary.excessReturnConfidence95Percent?.low) > 0,
    momentumBenchmarkFullyMatched: momentum.sampleCount >= minimumOutOfSample,
    momentumBenchmarkExcessConfidenceAboveZero:
      Number(momentum.excessReturnConfidence95Percent?.low) > 0,
    oneExplicitScoringModelVersion:
      modelVersions.length === 1 && modelVersions[0] !== "UNVERSIONED",
  };
  const reasons = Object.entries(checks)
    .filter(([, passed]) => !passed)
    .map(([name]) => name);
  return {
    approved: reasons.length === 0,
    primaryBenchmark,
    scoringModelVersions: modelVersions,
    maximumAllowedDrawdownPercent,
    checks,
    reasons,
  };
}

export function buildProofReport(outcomeState = {}, {
  feePercent = 0.15,
  slippagePercent = 0.1,
  minimumTrainingSamples = 70,
  minimumOutOfSample = 30,
  purgeDays = 1,
  maximumAllowedDrawdownPercent = 20,
  generatedAt = Date.now(),
} = {}) {
  const observations = Array.isArray(outcomeState?.observations)
    ? outcomeState.observations
    : [];
  const assets = {};
  const cost = 2 * (feePercent + slippagePercent);
  for (const assetClass of ["stock", "crypto"]) {
    const breakoutPercent = assetClass === "crypto" ? 10 : 8;
    assets[assetClass] = { breakoutPercent, horizons: {} };
    for (const days of HORIZONS) {
      const rows = measuredRows(observations, assetClass, days);
      const split = walkForwardSplit(rows, {
        days,
        minimumTrainingSamples,
        purgeDays,
      });
      const matchedBenchmarks = Object.fromEntries(
        ["SPY", "Bitcoin", "simpleMomentum"].map((name) => [
          name,
          matchedBenchmarkSummary(split.outOfSample, name, cost),
        ])
      );
      const summaryOptions = { feePercent, slippagePercent, breakoutPercent };
      const outOfSample = summarize(split.outOfSample, summaryOptions);
      const productionReadiness = assessProductionReadiness({
        assetClass,
        outOfSample,
        matchedBenchmarks,
        rows: split.outOfSample,
        minimumOutOfSample,
        maximumAllowedDrawdownPercent,
      });
      assets[assetClass].horizons[days] = {
        all: summarize(rows, summaryOptions),
        training: summarize(split.training, summaryOptions),
        outOfSample,
        matchedBenchmarks,
        outOfSampleSegments: {
          discoveryTier: summarizeSegments(split.outOfSample, "discoveryTier", summaryOptions),
          marketRegime: summarizeSegments(split.outOfSample, "marketRegime", summaryOptions),
          liquidity: summarizeSegments(split.outOfSample, "liquidityBucket", summaryOptions),
          marketCap: summarizeSegments(split.outOfSample, "marketCapBucket", summaryOptions),
        },
        scoreReliabilityBands: scoreReliabilityBands(split.outOfSample, summaryOptions),
        outOfSampleReady: split.outOfSample.length >= minimumOutOfSample,
        productionReadiness,
        trainingCutoffAt: split.cutoffAt,
        purgedBoundarySamples: split.purgedCount,
        splitPolicy: "LOCKED_EXPANDING_WALK_FORWARD_FIRST_N_TRAINING_WITH_PURGE",
      };
    }
  }
  return {
    version: 3,
    generatedAt: new Date(generatedAt).toISOString(),
    status: "EVIDENCE_REPORT_NOT_A_PERFORMANCE_GUARANTEE",
    methodology: {
      observationsIncludeUntradedCandidates: true,
      horizons: HORIZONS,
      feesPercentPerSide: feePercent,
      slippagePercentPerSide: slippagePercent,
      minimumTrainingSamples,
      minimumOutOfSample,
      purgeDays,
      maximumAllowedDrawdownPercent,
      overlapPolicy: "SAME_SYMBOL_OVERLAPPING_OOS_WINDOWS_REMOVED",
      drawdownMethod: "DATE_COHORT_EQUAL_WEIGHT_CANDIDATE_RETURNS_NOT_LIVE_PORTFOLIO_DRAWDOWN",
      benchmarkPolicy: "MATCHED_TO_THE_SAME_OOS_CANDIDATE_ROWS_WITH_EQUAL_COST_ASSUMPTIONS",
    },
    assets,
    productionClaimApproved: Object.values(assets).every((asset) =>
      HORIZONS.every((days) => asset.horizons[days].productionReadiness.approved)
    ),
    productionClaimReasons: Object.fromEntries(
      Object.entries(assets).map(([assetClass, asset]) => [assetClass,
        Object.fromEntries(HORIZONS.map((days) => [
          days,
          asset.horizons[days].productionReadiness.reasons,
        ]))
      ])
    ),
  };
}
