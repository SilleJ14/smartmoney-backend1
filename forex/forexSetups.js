import { FOREX_SPEC, pipSize } from "./forexSpec.js";

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function completedCandles(candles = []) {
  return candles.filter((candle) => candle && candle.complete !== false && Number.isFinite(num(candle.c)));
}

export function trueRange(candle, previous) {
  const high = num(candle.h);
  const low = num(candle.l);
  if (!previous) return Math.max(0, high - low);
  const prevClose = num(previous.c);
  return Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
}

export function averageTrueRange(candles, period = FOREX_SPEC.atrPeriod) {
  const rows = completedCandles(candles);
  if (rows.length < period + 1) return null;
  const slice = rows.slice(-(period + 1));
  let sum = 0;
  for (let index = 1; index < slice.length; index += 1) {
    sum += trueRange(slice[index], slice[index - 1]);
  }
  return sum / period;
}

export function rangeBounds(candles, lookback = FOREX_SPEC.rangeLookback) {
  const rows = completedCandles(candles);
  if (rows.length < lookback) return null;
  const window = rows.slice(-lookback);
  return {
    high: Math.max(...window.map((row) => num(row.h))),
    low: Math.min(...window.map((row) => num(row.l))),
    last: window[window.length - 1],
    prior: window[window.length - 2] || window[window.length - 1],
  };
}

export function isTightRange(bounds, atr, multiple = FOREX_SPEC.tightRangeAtrMultiple) {
  if (!bounds || !Number.isFinite(atr) || atr <= 0) return false;
  return bounds.high - bounds.low <= atr * multiple;
}

export function breakoutSide(bounds, close, atr, multiple = FOREX_SPEC.breakoutAtrMultiple) {
  if (!bounds || !Number.isFinite(atr) || atr <= 0) return null;
  if (close >= bounds.high + atr * multiple) return "buy";
  if (close <= bounds.low - atr * multiple) return "sell";
  return null;
}

export function evaluateEarlyBreakout(candles, quote = {}, spec = FOREX_SPEC) {
  const rows = completedCandles(candles);
  const atr = averageTrueRange(rows, spec.atrPeriod);
  const bounds = rangeBounds(rows, spec.rangeLookback);
  if (!atr || !bounds) {
    return { system: "earlyBreakout", forexState: "blocked", reason: "INSUFFICIENT_CANDLES" };
  }
  const lastClose = num(bounds.last.c);
  const mid = Number.isFinite(num(quote.mid)) ? num(quote.mid) : lastClose;
  if (!isTightRange(bounds, atr, spec.tightRangeAtrMultiple)) {
    return {
      system: "earlyBreakout",
      forexState: "watch",
      reason: "RANGE_NOT_TIGHT",
      atr,
      bounds,
      plannedEntry: mid,
    };
  }

  let breakoutIndex = -1;
  let side = null;
  const start = Math.max(0, rows.length - spec.rangeLookback);
  for (let index = start; index < rows.length; index += 1) {
    const window = rows.slice(Math.max(0, index - spec.rangeLookback + 1), index + 1);
    const localBounds = {
      high: Math.max(...window.slice(0, -1).map((row) => num(row.h)), num(window[0].h)),
      low: Math.min(...window.slice(0, -1).map((row) => num(row.l)), num(window[0].l)),
    };
    if (window.length < 3) continue;
    const prior = window.slice(0, -1);
    const priorBounds = {
      high: Math.max(...prior.map((row) => num(row.h))),
      low: Math.min(...prior.map((row) => num(row.l))),
    };
    const detected = breakoutSide(priorBounds, num(window[window.length - 1].c), atr, spec.breakoutAtrMultiple);
    if (detected) {
      breakoutIndex = index;
      side = detected;
      bounds.high = priorBounds.high;
      bounds.low = priorBounds.low;
    }
  }

  if (!side) {
    return {
      system: "earlyBreakout",
      forexState: "watch",
      reason: "TIGHT_RANGE",
      atr,
      bounds,
      plannedEntry: side === "sell" ? bounds.low : bounds.high,
    };
  }

  const candlesSince = rows.length - 1 - breakoutIndex;
  const breakoutDistance = Math.abs((side === "buy" ? bounds.high : bounds.low) - num(rows[breakoutIndex].c));
  const bound = side === "buy" ? bounds.high : bounds.low;
  const extremeSince = side === "buy"
    ? Math.min(...rows.slice(breakoutIndex).map((row) => num(row.l)))
    : Math.max(...rows.slice(breakoutIndex).map((row) => num(row.h)));
  const retrace = breakoutDistance > 0
    ? (side === "buy" ? (bound - extremeSince) / breakoutDistance : (extremeSince - bound) / breakoutDistance)
    : 0;
  const closedThrough = side === "buy"
    ? rows.slice(breakoutIndex + 1).some((row) => num(row.c) < bound)
    : rows.slice(breakoutIndex + 1).some((row) => num(row.c) > bound);

  if (closedThrough && spec.failCloseBackThroughBound) {
    return { system: "earlyBreakout", forexState: "blocked", reason: "SETUP_FAILED", side, atr, bounds };
  }
  if (candlesSince > spec.entryExpireCandles) {
    return { system: "earlyBreakout", forexState: "blocked", reason: "ENTRY_EXPIRED_TIME", side, atr, bounds };
  }

  const plannedEntry = bound;
  const distanceAtr = atr > 0 ? Math.abs(mid - plannedEntry) / atr : 99;
  if (distanceAtr > spec.entryMaxDistanceAtr) {
    return { system: "earlyBreakout", forexState: "blocked", reason: "ENTRY_EXPIRED_DISTANCE", side, atr, bounds, plannedEntry };
  }

  const confirmed = side === "buy"
    ? lastClose >= bound + atr * spec.retestConfirmAtrMultiple
    : lastClose <= bound - atr * spec.retestConfirmAtrMultiple;
  const inRetestWindow = candlesSince >= 1 && candlesSince <= spec.retestMaxCandles && retrace <= spec.retestMaxRetrace;

  if (candlesSince === 0) {
    return { system: "earlyBreakout", forexState: "trigger", reason: "BREAKOUT", side, atr, bounds, plannedEntry };
  }
  if (inRetestWindow && !confirmed) {
    return { system: "earlyBreakout", forexState: "retest", reason: "RETEST", side, atr, bounds, plannedEntry, retrace };
  }
  if (confirmed) {
    return { system: "earlyBreakout", forexState: "ready", reason: "RETEST_HELD", side, atr, bounds, plannedEntry };
  }
  return { system: "earlyBreakout", forexState: "trigger", reason: "WAITING_RETEST", side, atr, bounds, plannedEntry };
}

export function evaluateContinuation(candles, quote = {}, spec = FOREX_SPEC) {
  const rows = completedCandles(candles);
  const atr = averageTrueRange(rows, spec.atrPeriod);
  if (!atr || rows.length < spec.continuationLookback) {
    return { system: "continuation", forexState: "blocked", reason: "INSUFFICIENT_CANDLES" };
  }
  const window = rows.slice(-spec.continuationLookback);
  const last = window[window.length - 1];
  const first = window[0];
  const swingHigh = Math.max(...window.map((row) => num(row.h)));
  const swingLow = Math.min(...window.map((row) => num(row.l)));
  const impulse = swingHigh - swingLow;
  if (impulse <= 0) {
    return { system: "continuation", forexState: "blocked", reason: "NO_IMPULSE", atr };
  }
  const mid = Number.isFinite(num(quote.mid)) ? num(quote.mid) : num(last.c);
  const upTrend = num(last.c) > num(first.c);
  const side = upTrend ? "buy" : "sell";
  const retrace = upTrend
    ? (swingHigh - num(last.l)) / impulse
    : (num(last.h) - swingLow) / impulse;
  if (retrace >= spec.continuationFailRetrace) {
    return { system: "continuation", forexState: "blocked", reason: "SETUP_FAILED", side, atr };
  }
  const inPullback = retrace >= spec.continuationPullbackMin && retrace <= spec.continuationPullbackMax;
  const resumeLevel = upTrend ? num(last.h) : num(last.l);
  const resumed = upTrend
    ? num(last.c) >= resumeLevel - atr * spec.continuationResumeAtrMultiple && retrace <= spec.continuationPullbackMax
    : num(last.c) <= resumeLevel + atr * spec.continuationResumeAtrMultiple && retrace <= spec.continuationPullbackMax;
  const plannedEntry = mid;
  if (inPullback && !resumed) {
    return { system: "continuation", forexState: "retest", reason: "PULLBACK", side, atr, plannedEntry, retrace };
  }
  if (inPullback && resumed) {
    return { system: "continuation", forexState: "ready", reason: "RESUME", side, atr, plannedEntry, retrace };
  }
  return { system: "continuation", forexState: "watch", reason: "TREND", side, atr, plannedEntry, retrace };
}

export function pickDominantSetup(breakout, continuation) {
  const rank = { ready: 4, retest: 3, trigger: 2, watch: 1, blocked: 0 };
  const left = rank[breakout?.forexState] || 0;
  const right = rank[continuation?.forexState] || 0;
  return right > left ? continuation : breakout;
}

export function stopPrice(side, entry, atr, spec = FOREX_SPEC) {
  const distance = atr * spec.stopAtrMultiple;
  return side === "sell" ? entry + distance : entry - distance;
}

export function priceBound(side, entry, atr, instrument, spec = FOREX_SPEC) {
  const pip = pipSize(instrument);
  const distance = Math.max(atr * spec.priceBoundAtrMultiple, spec.minPriceBoundPips * pip);
  return side === "sell" ? entry - distance : entry + distance;
}
