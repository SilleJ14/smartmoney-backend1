import { forexMarketState } from "./sessionHours.js";
export const PERIOD_MS = {
  M15: 15 * 60 * 1000,
  H1: 60 * 60 * 1000,
  H4: 4 * 60 * 60 * 1000,
};

function hasTradingTime(start, end) {
  for (let t = start; t < end; t += 30 * 60000) if (forexMarketState(t).open) return true;
  return false;
}

export function inspectCandles(candles = [], granularity = "M15", { now } = {}) {
  const period = PERIOD_MS[granularity];
  if (!Array.isArray(candles)) return { ok: false, issues: ["CANDLE_ARRAY_INVALID"], completedCount: 0 };
  const completed = candles.filter((row) => row && row.complete === true);
  const issues = [];
  if (!completed.length) issues.push("CANDLES_UNAVAILABLE");
  if (candles.some((row) => !row || typeof row !== "object" || typeof row.complete !== "boolean")) issues.push("CANDLE_INVALID");
  const seen = new Set();
  let previous = null;
  for (const row of completed) {
    const values = [row.o, row.h, row.l, row.c].map(Number);
    if (values.some((value) => !Number.isFinite(value) || value <= 0)
      || Number(row.h) < Math.max(Number(row.o), Number(row.c), Number(row.l))
      || Number(row.l) > Math.min(Number(row.o), Number(row.c))) issues.push("CANDLE_OHLC_INVALID");
    const time = Date.parse(row.t || row.time || "");
    if (!Number.isFinite(time)) {
      issues.push("CANDLE_TIMESTAMP_INVALID");
      continue;
    }
    if (seen.has(time)) issues.push("CANDLE_DUPLICATE");
    seen.add(time);
    if (previous != null && time < previous) issues.push("CANDLE_OUT_OF_ORDER");
    if (previous != null && period && time - previous > period * 1.5
      && hasTradingTime(previous + period, time)) issues.push("CANDLE_GAP");
    if (Number.isFinite(now) && time + period > now) issues.push("CANDLE_NOT_CLOSED");
    previous = time;
  }
  if (Number.isFinite(now) && previous != null && now - previous > period * 2 + 30000
    && hasTradingTime(previous + period, now - period - 30000)) issues.push("CANDLES_STALE");
  return {
    ok: issues.length === 0,
    issues: [...new Set(issues)],
    completedCount: completed.length,
    source: candles[0]?.source || "oanda_candles",
  };
}

export function latestCompletedCloseTime(candles = []) {
  const completed = candles.filter((row) => row && row.complete !== false);
  const last = completed[completed.length - 1];
  return last ? Date.parse(last.t || last.time || "") : null;
}
