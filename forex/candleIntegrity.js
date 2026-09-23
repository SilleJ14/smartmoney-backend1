const PERIOD_MS = {
  M15: 15 * 60 * 1000,
  H1: 60 * 60 * 1000,
  H4: 4 * 60 * 60 * 1000,
};

export function inspectCandles(candles = [], granularity = "M15") {
  const period = PERIOD_MS[granularity];
  const completed = candles.filter((row) => row && row.complete !== false);
  const issues = [];
  const seen = new Set();
  let previous = null;
  for (const row of completed) {
    const time = Date.parse(row.t || row.time || "");
    if (!Number.isFinite(time)) {
      issues.push("CANDLE_TIMESTAMP_INVALID");
      continue;
    }
    if (seen.has(time)) issues.push("CANDLE_DUPLICATE");
    seen.add(time);
    if (previous != null && time < previous) issues.push("CANDLE_OUT_OF_ORDER");
    if (previous != null && period && time - previous > period * 1.5) issues.push("CANDLE_GAP");
    previous = time;
  }
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
