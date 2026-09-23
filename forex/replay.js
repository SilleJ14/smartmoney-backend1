import { confirmedSwings } from "./swings.js";

export function candlesKnownAt(candles = [], decisionTime, periodMs = 0) {
  const at = Date.parse(decisionTime);
  return candles.filter((row) => {
    const t = Date.parse(row.t || row.time || "");
    const closedAt = row.closedAt ? Date.parse(row.closedAt) : t + periodMs;
    return Number.isFinite(t) && closedAt <= at && row.complete !== false;
  });
}

export function swingsKnownAt(candles, decisionTime) {
  const known = candlesKnownAt(candles, decisionTime);
  return confirmedSwings(known);
}

export function replayDecision({ evaluate, h4 = [], h1 = [], m15 = [], side, decisionTime }) {
  return evaluate({
    h4: candlesKnownAt(h4, decisionTime, 4 * 3600000),
    h1: candlesKnownAt(h1, decisionTime, 3600000),
    m15: candlesKnownAt(m15, decisionTime, 900000),
    side,
  });
}
