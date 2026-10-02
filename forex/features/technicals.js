import { featureResult, finite, linearSlope, mean, returns, sampleStd, unavailable } from "./core.js";

function validCandles(candles) {
  return Array.isArray(candles) && candles.every((row) =>
    row && finite(row.high) && finite(row.low) && finite(row.close) && row.high >= row.low);
}

export function analyzeTechnicalRegime(candles, { lookback = 20, breakoutLookback = 10 } = {}) {
  if (!validCandles(candles)) return unavailable(["candles"], ["MALFORMED_CANDLES"]);
  if (candles.length < Math.max(lookback, breakoutLookback + 1)) {
    return unavailable([`candles>=${Math.max(lookback, breakoutLookback + 1)}`], ["INSUFFICIENT_CANDLES"]);
  }
  const window = candles.slice(-lookback);
  const closes = window.map((row) => row.close);
  const slope = linearSlope(closes);
  const averageClose = mean(closes);
  const normalizedSlope = slope / averageClose;
  const recentRange = Math.max(...window.map((row) => row.high)) - Math.min(...window.map((row) => row.low));
  const trend = Math.abs(normalizedSlope) < 0.0001 ? "flat" : normalizedSlope > 0 ? "up" : "down";
  const mode = trend === "flat" ? "range" : "trend";
  const current = candles.at(-1);
  const prior = candles.slice(-(breakoutLookback + 1), -1);
  const priorHigh = Math.max(...prior.map((row) => row.high));
  const priorLow = Math.min(...prior.map((row) => row.low));
  const breakout = current.close > priorHigh ? "up" : current.close < priorLow ? "down" : "none";
  const allReturns = returns(candles.map((row) => row.close));
  const recentVol = sampleStd(allReturns.slice(-Math.min(10, allReturns.length)));
  const baselineVol = sampleStd(allReturns);
  const ratio = baselineVol && recentVol !== null ? recentVol / baselineVol : null;
  const volatilityRegime = ratio === null ? null : ratio > 1.25 ? "high" : ratio < 0.75 ? "low" : "normal";
  return featureResult({
    evidence: {
      trend, mode, breakout, volatilityRegime, normalizedSlope,
      range: recentRange, priorHigh, priorLow, volatilityRatio: ratio,
    },
    reasons: volatilityRegime === null ? ["VOLATILITY_VARIANCE_UNAVAILABLE"] : [],
  });
}

export function analyzeMultiTimeframe(timeframes) {
  const required = ["D", "H4", "H1", "M15", "M5"];
  const missing = required.filter((timeframe) => !Array.isArray(timeframes?.[timeframe]));
  if (missing.length) return unavailable(missing.map((item) => `timeframes.${item}`), ["MISSING_TIMEFRAMES"]);
  const trends = {};
  for (const timeframe of required) {
    const closes = timeframes[timeframe];
    if (closes.length < 2 || closes.some((value) => !finite(value))) {
      return unavailable([`timeframes.${timeframe}.validCloses>=2`], ["MALFORMED_TIMEFRAME"]);
    }
    const slope = linearSlope(closes);
    const threshold = Math.abs(mean(closes)) * 1e-6;
    trends[timeframe] = Math.abs(slope) <= threshold ? "flat" : slope > 0 ? "up" : "down";
  }
  const directional = Object.values(trends).filter((trend) => trend !== "flat");
  const aligned = directional.length === required.length && new Set(directional).size === 1;
  return featureResult({ evidence: { trends, aligned, alignment: aligned ? directional[0] : "mixed" } });
}

export function analyzeMarketStructure(candles, { pivotSpan = 1, retestTolerance = 0.001 } = {}) {
  if (!validCandles(candles)) return unavailable(["candles"], ["MALFORMED_CANDLES"]);
  if (candles.length < pivotSpan * 2 + 3) return unavailable(["moreCandles"], ["INSUFFICIENT_STRUCTURE_HISTORY"]);
  const highs = [];
  const lows = [];
  for (let index = pivotSpan; index < candles.length - pivotSpan; index += 1) {
    const neighbors = candles.slice(index - pivotSpan, index + pivotSpan + 1);
    if (neighbors.every((row, i) => i === pivotSpan || candles[index].high > row.high)) {
      highs.push({ index, price: candles[index].high });
    }
    if (neighbors.every((row, i) => i === pivotSpan || candles[index].low < row.low)) {
      lows.push({ index, price: candles[index].low });
    }
  }
  if (!highs.length || !lows.length) return unavailable(["pivotHigh", "pivotLow"], ["NO_CONFIRMED_PIVOTS"]);
  const labeledHighs = highs.map((point, index) => ({
    ...point,
    label: index === 0 ? null : point.price > highs[index - 1].price ? "HH" : "LH",
  }));
  const labeledLows = lows.map((point, index) => ({
    ...point,
    label: index === 0 ? null : point.price > lows[index - 1].price ? "HL" : "LL",
  }));
  const resistance = highs.at(-1).price;
  const support = lows.at(-1).price;
  const close = candles.at(-1).close;
  const previousClose = candles.at(-2).close;
  const breakDirection = close > resistance ? "up" : close < support ? "down" : "none";
  const retest = breakDirection === "none" && (
    (previousClose > resistance && Math.abs(close - resistance) / resistance <= retestTolerance) ||
    (previousClose < support && Math.abs(close - support) / support <= retestTolerance)
  );
  return featureResult({
    evidence: { highs: labeledHighs, lows: labeledLows, support, resistance, breakDirection, retest },
  });
}

export function analyzeMomentum(closes, { persistenceWindow = 5 } = {}) {
  if (!Array.isArray(closes) || closes.length < Math.max(4, persistenceWindow + 1) || closes.some((value) => !finite(value) || value <= 0)) {
    return unavailable(["validCloses"], ["INSUFFICIENT_MOMENTUM_HISTORY"]);
  }
  const changes = returns(closes);
  const split = Math.floor(changes.length / 2);
  const prior = mean(changes.slice(0, split));
  const recent = mean(changes.slice(split));
  const recentChanges = changes.slice(-persistenceWindow);
  const direction = recent === 0 ? "flat" : recent > 0 ? "up" : "down";
  const matching = direction === "flat" ? recentChanges.filter((value) => value === 0).length :
    recentChanges.filter((value) => Math.sign(value) === Math.sign(recent)).length;
  return featureResult({
    evidence: {
      direction,
      strength: Math.abs(recent),
      acceleration: recent - prior,
      persistence: matching / recentChanges.length,
      observations: changes.length,
    },
  });
}

export function analyzeVolatility(candles, { atrPeriod = 14, recentWindow = 5 } = {}) {
  if (!validCandles(candles)) return unavailable(["candles"], ["MALFORMED_CANDLES"]);
  if (candles.length < atrPeriod + 1) return unavailable([`candles>=${atrPeriod + 1}`], ["INSUFFICIENT_VOLATILITY_HISTORY"]);
  const trueRanges = [];
  for (let index = 1; index < candles.length; index += 1) {
    const row = candles[index];
    const priorClose = candles[index - 1].close;
    trueRanges.push(Math.max(row.high - row.low, Math.abs(row.high - priorClose), Math.abs(row.low - priorClose)));
  }
  const atr = mean(trueRanges.slice(-atrPeriod));
  const closeReturns = returns(candles.map((row) => row.close));
  const realizedVolatility = sampleStd(closeReturns);
  const recentAtr = mean(trueRanges.slice(-recentWindow));
  const earlier = trueRanges.slice(-recentWindow * 2, -recentWindow);
  const priorAtr = earlier.length ? mean(earlier) : null;
  const expansionRatio = priorAtr ? recentAtr / priorAtr : null;
  const regime = expansionRatio === null ? null : expansionRatio > 1.1 ? "expansion" : expansionRatio < 0.9 ? "contraction" : "stable";
  return featureResult({
    evidence: { atr, realizedVolatility, expansionRatio, regime },
    reasons: regime === null ? ["EXPANSION_BASELINE_UNAVAILABLE"] : [],
  });
}
