function normalCdf(value) {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * x);
  const polynomial = (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t
    - 0.284496736) * t + 0.254829592) * t;
  const erf = 1 - polynomial * Math.exp(-x * x);
  return 0.5 * (1 + sign * erf);
}

function moments(values) {
  const n = values.length;
  const mean = values.reduce((sum, value) => sum + value, 0) / (n || 1);
  const m2 = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (n || 1);
  const skew = m2 ? values.reduce((sum, value) => sum + (value - mean) ** 3, 0) / n / m2 ** 1.5 : 0;
  const kurtosis = m2 ? values.reduce((sum, value) => sum + (value - mean) ** 4, 0) / n / m2 ** 2 : 3;
  return { n, mean, standardDeviation: Math.sqrt(m2), skew, kurtosis };
}

export function probabilisticSharpeRatio(returns, { benchmarkSharpe = 0, periodsPerYear = 1 } = {}) {
  const stats = moments(returns.map(Number));
  if (stats.n < 2 || !stats.standardDeviation) return stats.mean > 0 ? 1 : 0.5;
  const sharpe = stats.mean / stats.standardDeviation * Math.sqrt(periodsPerYear);
  const benchmark = Number(benchmarkSharpe);
  const denominator = Math.sqrt(Math.max(1e-12,
    1 - stats.skew * sharpe + ((stats.kurtosis - 1) / 4) * sharpe ** 2));
  const z = (sharpe - benchmark) * Math.sqrt(stats.n - 1) / denominator;
  return normalCdf(z);
}

export function deflatedSharpeRatio(returns, {
  trials = 1,
  periodsPerYear = 1,
  sharpeStd = 1,
} = {}) {
  const count = Math.max(1, Number(trials));
  const expectedMaximum = count <= 1 ? 0
    : Number(sharpeStd) * Math.sqrt(2 * Math.log(count));
  return {
    probability: probabilisticSharpeRatio(returns, {
      benchmarkSharpe: expectedMaximum,
      periodsPerYear,
    }),
    expectedMaximumSharpe: expectedMaximum,
    trials: count,
  };
}

function combinations(values, size, start = 0, prefix = [], output = []) {
  if (prefix.length === size) { output.push(prefix); return output; }
  for (let index = start; index <= values.length - (size - prefix.length); index += 1) {
    combinations(values, size, index + 1, [...prefix, values[index]], output);
  }
  return output;
}

export function cscvPbo(strategyReturns, { partitions = 8 } = {}) {
  const names = Object.keys(strategyReturns);
  if (names.length < 2) throw new Error("PBO requires at least two strategies");
  const length = Math.min(...names.map((name) => strategyReturns[name].length));
  if (partitions < 2 || partitions % 2 || partitions > length) throw new Error("partitions must be even and fit observations");
  const slices = Array.from({ length: partitions }, (_, index) => {
    const start = Math.floor(index * length / partitions);
    const end = Math.floor((index + 1) * length / partitions);
    return Array.from({ length: end - start }, (__, offset) => start + offset);
  });
  const folds = combinations([...slices.keys()], partitions / 2);
  const logits = [];
  for (const trainParts of folds) {
    const trainSet = new Set(trainParts);
    const trainIndices = trainParts.flatMap((index) => slices[index]);
    const testIndices = slices.filter((_, index) => !trainSet.has(index)).flat();
    const score = (name, indices) => indices.reduce((sum, index) => sum + Number(strategyReturns[name][index]), 0)
      / indices.length;
    const winner = [...names].sort((a, b) => score(b, trainIndices) - score(a, trainIndices))[0];
    const ranked = [...names].sort((a, b) => score(a, testIndices) - score(b, testIndices));
    const rank = ranked.indexOf(winner) + 1;
    const percentile = (rank - 0.5) / names.length;
    logits.push(Math.log(percentile / (1 - percentile)));
  }
  return {
    pbo: logits.filter((value) => value <= 0).length / logits.length,
    logits,
    combinations: logits.length,
  };
}
