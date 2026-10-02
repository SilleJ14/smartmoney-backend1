export function createSeededRandom(seed = 1) {
  let state = Number(seed) >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

export function seededShuffle(values, random) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
}

export function blockBootstrap(values, { blockSize = 5, random = createSeededRandom(1), length = values.length } = {}) {
  if (!values.length) return [];
  if (!Number.isInteger(blockSize) || blockSize < 1) throw new TypeError("blockSize must be positive");
  const result = [];
  while (result.length < length) {
    const start = Math.floor(random() * values.length);
    for (let offset = 0; offset < blockSize && result.length < length; offset += 1) {
      result.push(values[(start + offset) % values.length]);
    }
  }
  return result;
}

function pathMetrics(path) {
  let equity = 0;
  let peak = 0;
  let maxDrawdown = 0;
  for (const value of path) {
    equity += Number(value);
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak - equity);
  }
  return { total: equity, maxDrawdown };
}

export function monteCarloTradeOrder(trades, { iterations = 1000, seed = 1 } = {}) {
  const random = createSeededRandom(seed);
  return Array.from({ length: iterations }, () => {
    const path = seededShuffle(trades, random);
    return { path, ...pathMetrics(path) };
  });
}

export function monteCarloBlockBootstrap(trades, {
  iterations = 1000,
  seed = 1,
  blockSize = Math.max(1, Math.round(Math.sqrt(trades.length))),
} = {}) {
  const random = createSeededRandom(seed);
  return Array.from({ length: iterations }, () => {
    const path = blockBootstrap(trades, { blockSize, random });
    return { path, ...pathMetrics(path) };
  });
}

export function percentile(values, probability) {
  if (!values.length) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const weight = position - lower;
  return sorted[lower] * (1 - weight) + sorted[Math.min(lower + 1, sorted.length - 1)] * weight;
}

export function summarizeSimulations(simulations) {
  const totals = simulations.map((row) => row.total);
  const drawdowns = simulations.map((row) => row.maxDrawdown);
  return {
    totalP05: percentile(totals, 0.05),
    totalMedian: percentile(totals, 0.5),
    totalP95: percentile(totals, 0.95),
    drawdownP95: percentile(drawdowns, 0.95),
    lossProbability: totals.filter((value) => value < 0).length / (totals.length || 1),
  };
}
