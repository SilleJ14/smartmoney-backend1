import { confirmedSwings } from "./swings.js";

export function candlesKnownAt(candles = [], decisionTime) {
  const at = Date.parse(decisionTime);
  return candles.filter((row) => {
    const t = Date.parse(row.t || row.time || "");
    return Number.isFinite(t) && t <= at && row.complete !== false;
  });
}

export function swingsKnownAt(candles, decisionTime) {
  const known = candlesKnownAt(candles, decisionTime);
  return confirmedSwings(known);
}

export function replayDecision({ evaluate, h4 = [], h1 = [], m15 = [], side, decisionTime }) {
  return evaluate({
    h4: candlesKnownAt(h4, decisionTime),
    h1: candlesKnownAt(h1, decisionTime),
    m15: candlesKnownAt(m15, decisionTime),
    side,
  });
}
