function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

export function trueRange(candle, previous) {
  const high = num(candle?.h);
  const low = num(candle?.l);
  const prevClose = num(previous?.c);
  if (![high, low].every(Number.isFinite)) return NaN;
  if (!Number.isFinite(prevClose)) return high - low;
  return Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
}

// Wilder ATR(14). First value is the SMA of the first `period` true ranges.
// Subsequent: (prev * (period - 1) + tr) / period. Same implementation for replay and live.
export function wilderAtr(candles = [], period = 14) {
  const rows = candles.filter((candle) => candle && candle.complete !== false);
  if (rows.length < period + 1) return null;
  const ranges = [];
  for (let index = 1; index < rows.length; index += 1) {
    ranges.push(trueRange(rows[index], rows[index - 1]));
  }
  if (ranges.length < period) return null;
  let atr = ranges.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  const series = [{ index: period, atr }];
  for (let index = period; index < ranges.length; index += 1) {
    atr = (atr * (period - 1) + ranges[index]) / period;
    series.push({ index: index + 1, atr });
  }
  return { atr, series, period };
}

export function atrBeforeWindow(candles, windowStartIndex, period = 14) {
  if (windowStartIndex < period + 1) return null;
  const history = candles.slice(0, windowStartIndex);
  const computed = wilderAtr(history, period);
  return computed?.atr ?? null;
}

export function emaSeries(values, period) {
  if (!Array.isArray(values) || values.length < period) return [];
  const k = 2 / (period + 1);
  let ema = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  const series = Array(period - 1).fill(null);
  series.push(ema);
  for (let index = period; index < values.length; index += 1) {
    ema = values[index] * k + ema * (1 - k);
    series.push(ema);
  }
  return series;
}
