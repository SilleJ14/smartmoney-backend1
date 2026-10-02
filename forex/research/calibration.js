export function calibrationAnalysis(observations, { binCount = 10 } = {}) {
  if (!Number.isInteger(binCount) || binCount < 1) throw new TypeError("binCount must be positive");
  const rows = observations.map((row) => {
    const probability = Number(row.probability ?? row.forecast);
    const outcome = Number(row.outcome);
    if (probability < 0 || probability > 1 || ![0, 1].includes(outcome)) {
      throw new RangeError("Probabilities must be in [0,1] and outcomes binary");
    }
    return { probability, outcome };
  });
  const bins = Array.from({ length: binCount }, (_, index) => ({
    lower: index / binCount,
    upper: (index + 1) / binCount,
    count: 0,
    probabilitySum: 0,
    outcomeSum: 0,
  }));
  for (const row of rows) {
    const index = Math.min(binCount - 1, Math.floor(row.probability * binCount));
    bins[index].count += 1;
    bins[index].probabilitySum += row.probability;
    bins[index].outcomeSum += row.outcome;
  }
  const baseRate = rows.reduce((sum, row) => sum + row.outcome, 0) / (rows.length || 1);
  let reliability = 0;
  let resolution = 0;
  const outputBins = bins.map((bin) => {
    const meanForecast = bin.count ? bin.probabilitySum / bin.count : null;
    const observedFrequency = bin.count ? bin.outcomeSum / bin.count : null;
    if (bin.count) {
      const weight = bin.count / rows.length;
      reliability += weight * (meanForecast - observedFrequency) ** 2;
      resolution += weight * (observedFrequency - baseRate) ** 2;
    }
    return { lower: bin.lower, upper: bin.upper, count: bin.count, meanForecast, observedFrequency };
  });
  const uncertainty = baseRate * (1 - baseRate);
  const brierScore = rows.reduce((sum, row) => sum + (row.probability - row.outcome) ** 2, 0)
    / (rows.length || 1);
  const decomposedBrier = reliability - resolution + uncertainty;
  return Object.freeze({
    count: rows.length,
    baseRate,
    brierScore,
    reliability,
    resolution,
    uncertainty,
    decomposedBrier,
    binningResidual: brierScore - decomposedBrier,
    bins: outputBins,
  });
}
