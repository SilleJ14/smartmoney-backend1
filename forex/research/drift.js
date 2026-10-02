function quantile(values, probability) {
  const sorted = [...values].map(Number).sort((a, b) => a - b);
  if (!sorted.length) return NaN;
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const weight = position - lower;
  return sorted[lower] * (1 - weight) + sorted[Math.min(sorted.length - 1, lower + 1)] * weight;
}

export function confidenceBand(samples, { alpha = 0.05 } = {}) {
  if (!samples.length) throw new Error("confidenceBand requires samples");
  return {
    lower: quantile(samples, alpha / 2),
    upper: quantile(samples, 1 - alpha / 2),
  };
}

export function monitorDrift({ current = {}, confidenceBands = {} } = {}) {
  const checks = [
    ["EXPECTANCY", "expectancy", "lower"],
    ["COST", "cost", "upper"],
    ["CALIBRATION", "calibration", "upper"],
    ["DRAWDOWN", "drawdown", "upper"],
  ];
  const breaches = [];
  for (const [reason, metric, boundary] of checks) {
    const value = Number(current[metric]);
    const threshold = Number(confidenceBands[metric]?.[boundary]);
    if (!Number.isFinite(value) || !Number.isFinite(threshold)) continue;
    const breached = boundary === "lower" ? value < threshold : value > threshold;
    if (breached) breaches.push({ reason, metric, value, boundary, threshold });
  }
  return Object.freeze({
    action: breaches.length ? "PAUSE" : "CONTINUE",
    paused: breaches.length > 0,
    breaches,
    autoRetune: false,
  });
}
