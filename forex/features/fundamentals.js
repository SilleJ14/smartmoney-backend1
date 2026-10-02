import {
  G10_CURRENCIES,
  featureResult,
  finite,
  mean,
  pairCurrencies,
  sampleStd,
  unavailable,
} from "./core.js";

function solve(matrix, vector) {
  const a = matrix.map((row, index) => [...row, vector[index]]);
  for (let column = 0; column < a.length; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < a.length; row += 1) {
      if (Math.abs(a[row][column]) > Math.abs(a[pivot][column])) pivot = row;
    }
    if (Math.abs(a[pivot][column]) < 1e-12) return null;
    [a[column], a[pivot]] = [a[pivot], a[column]];
    const divisor = a[column][column];
    for (let j = column; j <= a.length; j += 1) a[column][j] /= divisor;
    for (let row = 0; row < a.length; row += 1) {
      if (row === column) continue;
      const factor = a[row][column];
      for (let j = column; j <= a.length; j += 1) a[row][j] -= factor * a[column][j];
    }
  }
  return a.map((row) => row[a.length]);
}

export function rankCurrencyStrength(pairReturns, currencies = G10_CURRENCIES) {
  if (!Array.isArray(pairReturns)) return unavailable(["pairReturns"], ["MALFORMED_INPUT"]);
  const universe = [...currencies];
  if (universe.length !== 8 || new Set(universe).size !== 8) {
    return unavailable(["eightCurrencyUniverse"], ["INVALID_CURRENCY_UNIVERSE"]);
  }
  const index = new Map(universe.map((currency, position) => [currency, position]));
  const rows = [];
  let malformed = 0;
  for (const item of pairReturns) {
    const pair = pairCurrencies(item?.pair);
    if (!pair || !finite(item?.return) || !index.has(pair[0]) || !index.has(pair[1]) || pair[0] === pair[1]) {
      malformed += 1;
      continue;
    }
    rows.push({ base: pair[0], quote: pair[1], value: item.return });
  }
  if (!rows.length) return unavailable(["validPairReturns"], ["NO_VALID_PAIR_RETURNS"]);

  const seen = new Set([universe[0]]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) {
      if (seen.has(row.base) && !seen.has(row.quote)) { seen.add(row.quote); changed = true; }
      if (seen.has(row.quote) && !seen.has(row.base)) { seen.add(row.base); changed = true; }
    }
  }
  const disconnected = universe.filter((currency) => !seen.has(currency));
  if (disconnected.length) return unavailable(disconnected.map((item) => `pairCoverage.${item}`), ["DISCONNECTED_CURRENCY_GRAPH"]);

  const unknowns = universe.length - 1;
  const normal = Array.from({ length: unknowns }, () => Array(unknowns).fill(0));
  const rhs = Array(unknowns).fill(0);
  for (const row of rows) {
    const vector = Array(unknowns).fill(0);
    const base = index.get(row.base);
    const quote = index.get(row.quote);
    if (base < unknowns) vector[base] = 1;
    if (quote < unknowns) vector[quote] = -1;
    for (let i = 0; i < unknowns; i += 1) {
      rhs[i] += vector[i] * row.value;
      for (let j = 0; j < unknowns; j += 1) normal[i][j] += vector[i] * vector[j];
    }
  }
  const solved = solve(normal, rhs);
  if (!solved) return unavailable(["independentPairCoverage"], ["SINGULAR_CURRENCY_GRAPH"]);
  const raw = [...solved, 0];
  const center = mean(raw);
  const strengths = Object.fromEntries(universe.map((currency, position) => [currency, raw[position] - center]));
  const ranking = universe
    .map((currency) => ({ currency, strength: strengths[currency] }))
    .sort((a, b) => b.strength - a.strength || a.currency.localeCompare(b.currency));
  const residualRmse = Math.sqrt(mean(rows.map((row) =>
    (strengths[row.base] - strengths[row.quote] - row.value) ** 2)));
  return featureResult({
    evidence: { strengths, ranking, observations: rows.length, residualRmse },
    reasons: malformed ? ["MALFORMED_OBSERVATIONS_IGNORED"] : [],
  });
}

export function analyzeRateDifferential({ base, quote, yields, expectedChanges } = {}) {
  const baseYield = yields?.[base];
  const quoteYield = yields?.[quote];
  const missing = [];
  if (!base) missing.push("base");
  if (!quote) missing.push("quote");
  if (!finite(baseYield)) missing.push(`yields.${base ?? "base"}`);
  if (!finite(quoteYield)) missing.push(`yields.${quote ?? "quote"}`);
  if (missing.length) return unavailable(missing, ["MISSING_RATE_EVIDENCE"]);
  const differential = baseYield - quoteYield;
  const expectedBaseChange = finite(expectedChanges?.[base]) ? expectedChanges[base] : null;
  const expectedQuoteChange = finite(expectedChanges?.[quote]) ? expectedChanges[quote] : null;
  const expectedDifferential = expectedBaseChange !== null && expectedQuoteChange !== null
    ? expectedBaseChange - expectedQuoteChange : null;
  return featureResult({
    evidence: {
      base, quote, baseYield, quoteYield, differential,
      expectedBaseChange,
      expectedQuoteChange,
      expectedDifferential,
      advantage: differential === 0 ? "neutral" : differential > 0 ? base : quote,
    },
    reasons: expectedDifferential === null ? ["EXPECTED_RATE_CHANGE_UNAVAILABLE"] : [],
  });
}

export function analyzeMacroSurprises(events) {
  if (!Array.isArray(events) || !events.length) return unavailable(["events"], ["NO_MACRO_EVENTS"]);
  const normalized = [];
  let malformed = 0;
  for (const event of events) {
    let scale = finite(event?.historicalScale) && event.historicalScale > 0 ? event.historicalScale : null;
    if (scale === null && Array.isArray(event?.historicalSurprises)) {
      scale = sampleStd(event.historicalSurprises.filter(finite));
    }
    if (!event?.currency || !finite(event?.actual) || !finite(event?.estimate) || !finite(scale) || scale <= 0) {
      malformed += 1;
      continue;
    }
    const direction = event.higherIsPositive === false ? -1 : 1;
    normalized.push({
      id: event.id ?? null,
      currency: event.currency,
      surprise: event.actual - event.estimate,
      normalizedSurprise: ((event.actual - event.estimate) / scale) * direction,
    });
  }
  if (!normalized.length) return unavailable(["validEvents"], ["NO_NORMALIZABLE_SURPRISES"]);
  const byCurrency = {};
  for (const item of normalized) (byCurrency[item.currency] ??= []).push(item.normalizedSurprise);
  const aggregate = Object.fromEntries(Object.entries(byCurrency).map(([currency, values]) => [currency, mean(values)]));
  return featureResult({
    evidence: { events: normalized, aggregate },
    reasons: malformed ? ["MALFORMED_EVENTS_IGNORED"] : [],
  });
}

export function analyzeCarry({ base, quote, rateDifferential, trend, volatility, liquidity } = {}) {
  const missing = [];
  if (!base) missing.push("base");
  if (!quote) missing.push("quote");
  if (!finite(rateDifferential)) missing.push("rateDifferential");
  if (!["up", "down", "flat"].includes(trend)) missing.push("trend");
  if (!["low", "normal", "high"].includes(volatility)) missing.push("volatility");
  if (typeof liquidity?.tradeable !== "boolean") missing.push("liquidity.tradeable");
  if (missing.length) return unavailable(missing, ["MISSING_CARRY_CONDITION"]);
  const direction = rateDifferential === 0 ? "neutral" : rateDifferential > 0 ? "long" : "short";
  const aligned = direction === "neutral" || trend === "flat" ||
    (direction === "long" && trend === "up") || (direction === "short" && trend === "down");
  const conditionsMet = direction !== "neutral" && aligned && volatility !== "high" && liquidity.tradeable;
  const reasons = [];
  if (direction === "neutral") reasons.push("NO_RATE_ADVANTAGE");
  if (!aligned) reasons.push("TREND_OPPOSES_CARRY");
  if (volatility === "high") reasons.push("HIGH_VOLATILITY");
  if (!liquidity.tradeable) reasons.push("NOT_TRADEABLE");
  return featureResult({ evidence: { base, quote, direction, rateDifferential, aligned, conditionsMet }, reasons });
}

export function analyzeTffPositioning({ current, history } = {}) {
  if (!finite(current) || !Array.isArray(history)) return unavailable(["current", "history"], ["MALFORMED_POSITIONING_INPUT"]);
  const clean = history.filter(finite);
  if (clean.length < 2) return unavailable(["history>=2"], ["INSUFFICIENT_POSITIONING_HISTORY"]);
  const center = mean(clean);
  const scale = sampleStd(clean);
  const belowOrEqual = clean.filter((value) => value <= current).length;
  return featureResult({
    evidence: {
      current,
      percentile: belowOrEqual / clean.length,
      zscore: scale === 0 ? null : (current - center) / scale,
      sampleSize: clean.length,
    },
    reasons: scale === 0 ? ["ZERO_HISTORICAL_VARIANCE"] : [],
  });
}
