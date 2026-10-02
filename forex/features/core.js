export const G10_CURRENCIES = Object.freeze(["USD", "EUR", "JPY", "GBP", "AUD", "CAD", "CHF", "NZD"]);

export function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

export function featureResult({ evidence = null, missing = [], reasons = [], state } = {}) {
  const absent = [...new Set(missing)].sort();
  const available = evidence !== null && absent.length === 0;
  return Object.freeze({
    available,
    state: state ?? (available ? "available" : evidence === null ? "unavailable" : "partial"),
    missing: absent,
    reasons: [...new Set(reasons)],
    evidence,
  });
}

export function unavailable(missing, reasons = ["INSUFFICIENT_DATA"], state = "unavailable") {
  return featureResult({ evidence: null, missing, reasons, state });
}

export function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

export function sampleStd(values) {
  if (values.length < 2) return null;
  const center = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - center) ** 2, 0) / (values.length - 1));
}

export function returns(values) {
  if (!Array.isArray(values)) return [];
  const output = [];
  for (let index = 1; index < values.length; index += 1) {
    if (!finite(values[index]) || !finite(values[index - 1]) || values[index - 1] === 0) return [];
    output.push(values[index] / values[index - 1] - 1);
  }
  return output;
}

export function linearSlope(values) {
  if (!Array.isArray(values) || values.length < 2 || values.some((value) => !finite(value))) return null;
  const xMean = (values.length - 1) / 2;
  const yMean = mean(values);
  let numerator = 0;
  let denominator = 0;
  values.forEach((value, index) => {
    numerator += (index - xMean) * (value - yMean);
    denominator += (index - xMean) ** 2;
  });
  return denominator ? numerator / denominator : 0;
}

export function pairCurrencies(pair) {
  if (typeof pair !== "string") return null;
  const normalized = pair.toUpperCase().replace(/[^A-Z]/g, "");
  if (normalized.length !== 6) return null;
  return [normalized.slice(0, 3), normalized.slice(3)];
}
