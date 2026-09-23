import { atrBeforeWindow, emaSeries } from "../indicators.js";
import { latestConfirmedSwings } from "../swings.js";

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

function completed(candles = []) {
  return candles.filter((candle) => candle && candle.complete !== false);
}

export function isFourHourUptrend(h4 = []) {
  const rows = completed(h4);
  const closes = rows.map((row) => num(row.c));
  const ema50 = emaSeries(closes, 50);
  const ema200 = emaSeries(closes, 200);
  const last = closes.length - 1;
  if (last < 3 || ema50[last] == null || ema200[last] == null || ema50[last - 3] == null) return false;
  return closes[last] > ema50[last] && ema50[last] > ema200[last] && ema50[last] > ema50[last - 3];
}

export function isFourHourDowntrend(h4) {
  const rows = completed(h4);
  const closes = rows.map((row) => num(row.c));
  const ema50 = emaSeries(closes, 50);
  const ema200 = emaSeries(closes, 200);
  const last = closes.length - 1;
  if (last < 3 || ema50[last] == null || ema200[last] == null || ema50[last - 3] == null) return false;
  return closes[last] < ema50[last] && ema50[last] < ema200[last] && ema50[last] < ema50[last - 3];
}

function breakoutQuality(candle, A, side) {
  const high = num(candle.h);
  const low = num(candle.l);
  const open = num(candle.o);
  const close = num(candle.c);
  const range = high - low;
  if (range <= 0 || range > 1.5 * A) return false;
  if (side === "buy") {
    if (!(close > open)) return false;
    return close >= low + 0.75 * range;
  }
  if (!(close < open)) return false;
  return close <= high - 0.75 * range;
}

export function evaluateBreakoutRetest({ h1 = [], m15 = [], h4 = [], side = "buy" } = {}) {
  const hours = completed(h1);
  const minutes = completed(m15);
  if (hours.length < 23) {
    return { status: "NONE", stage: "DISCOVERED", reason: "INSUFFICIENT_CANDLES", strategyId: "FOREX_BREAKOUT_RETEST_V1" };
  }
  const rangeStart = hours.length - 8;
  const range = hours.slice(rangeStart);
  const A = atrBeforeWindow(hours, rangeStart, 14);
  if (!Number.isFinite(A) || A <= 0) {
    return { status: "NONE", stage: "DISCOVERED", reason: "ATR_UNAVAILABLE", strategyId: "FOREX_BREAKOUT_RETEST_V1" };
  }
  const H = Math.max(...range.map((row) => num(row.h)));
  const L = Math.min(...range.map((row) => num(row.l)));
  const firstOpen = num(range[0].o);
  const lastClose = num(range[7].c);
  const tight = H - L <= 2.5 * A && Math.abs(firstOpen - lastClose) <= 0.75 * A;
  if (!tight) {
    return { status: "NONE", stage: "DISCOVERED", reason: "RANGE_NOT_TIGHT", strategyId: "FOREX_BREAKOUT_RETEST_V1", A };
  }
  if (side === "buy" && isFourHourDowntrend(h4)) {
    return { status: "INVALIDATED", stage: "BLOCKED", reason: "OPPOSING_TREND", strategyId: "FOREX_BREAKOUT_RETEST_V1", frozen: { H, L, A } };
  }
  if (side === "sell" && isFourHourUptrend(h4)) {
    return { status: "INVALIDATED", stage: "BLOCKED", reason: "OPPOSING_TREND", strategyId: "FOREX_BREAKOUT_RETEST_V1", frozen: { H, L, A } };
  }

  const threshold = side === "buy" ? H + 0.10 * A : L - 0.10 * A;
  const afterRange = minutes.slice(-8);
  let breakoutIndex = -1;
  for (let index = 1; index < afterRange.length; index += 1) {
    const close = num(afterRange[index].c);
    const prev = num(afterRange[index - 1].c);
    const crossed = side === "buy" ? close >= threshold && prev < threshold : close <= threshold && prev > threshold;
    if (crossed && breakoutQuality(afterRange[index], A, side)) {
      breakoutIndex = index;
      break;
    }
  }
  const frozen = { H, L, A, side };
  if (breakoutIndex < 0) {
    return { status: "CANDIDATE", stage: "WATCHING", reason: "RANGE_FROZEN", strategyId: "FOREX_BREAKOUT_RETEST_V1", frozen, passed: ["Range"], pending: ["Breakout"] };
  }

  const post = afterRange.slice(breakoutIndex);
  const failLow = side === "buy"
    ? post.some((row) => num(row.l) < H - 0.15 * A)
    : post.some((row) => num(row.h) > L + 0.15 * A);
  if (failLow) {
    return { status: "INVALIDATED", stage: "INVALIDATED", reason: "RETEST_FAILED", strategyId: "FOREX_BREAKOUT_RETEST_V1", frozen };
  }

  let retestIndex = -1;
  const retestWindow = post.slice(1, 5);
  for (let index = 0; index < retestWindow.length; index += 1) {
    const row = retestWindow[index];
    if (side === "buy") {
      if (num(row.l) >= H - 0.15 * A && num(row.l) <= H + 0.10 * A && num(row.c) >= H) {
        retestIndex = index + 1;
        break;
      }
    } else if (num(row.h) <= L + 0.15 * A && num(row.h) >= L - 0.10 * A && num(row.c) <= L) {
      retestIndex = index + 1;
      break;
    }
  }
  if (retestIndex < 0) {
    if (post.length > 5) {
      return { status: "INVALIDATED", stage: "EXPIRED", reason: "ENTRY_EXPIRED", strategyId: "FOREX_BREAKOUT_RETEST_V1", frozen };
    }
    return {
      status: "CANDIDATE",
      stage: "TRIGGER_CONFIRMED",
      reason: "BREAKOUT",
      strategyId: "FOREX_BREAKOUT_RETEST_V1",
      frozen,
      passed: ["Range", "Breakout"],
      pending: ["Retest confirmation"],
      executionAuthorization: "None",
    };
  }

  const retestCandle = post[retestIndex];
  const renewWindow = post.slice(retestIndex + 1, retestIndex + 4);
  const renewed = renewWindow.some((row) => (
    side === "buy"
      ? num(row.c) > num(retestCandle.h) + 0.05 * A
      : num(row.c) < num(retestCandle.l) - 0.05 * A
  ));
  if (!renewed) {
    if (post.length > retestIndex + 3) {
      return { status: "INVALIDATED", stage: "EXPIRED", reason: "ENTRY_EXPIRED", strategyId: "FOREX_BREAKOUT_RETEST_V1", frozen };
    }
    return {
      status: "CANDIDATE",
      stage: "WATCHING",
      reason: "RETEST",
      strategyId: "FOREX_BREAKOUT_RETEST_V1",
      frozen,
      passed: ["Range", "Breakout", "Retest"],
      pending: ["Renewed movement"],
      executionAuthorization: "None",
    };
  }

  const sequence = post.slice(0, retestIndex + 1 + renewWindow.length);
  const stop = side === "buy"
    ? Math.min(...sequence.map((row) => num(row.l))) - 0.10 * A
    : Math.max(...sequence.map((row) => num(row.h))) + 0.10 * A;
  return {
    status: "CANDIDATE",
    stage: "WATCHING",
    reason: "RENEWED_MOVEMENT",
    strategyId: "FOREX_BREAKOUT_RETEST_V1",
    frozen,
    stop,
    passed: ["Range", "Breakout", "Retest", "Renewed movement"],
    pending: ["Strategy approval"],
    executionAuthorization: "None",
  };
}

export function nearestHourSwingClearance({ h1, entry, side, A, lookback = 120 }) {
  const hours = completed(h1);
  const at = hours.length - 1;
  const swings = latestConfirmedSwings(hours.slice(-lookback), hours.slice(-lookback).length - 1);
  if (side === "buy") {
    const above = (swings.highs || []).filter((swing) => swing.price > entry);
    const nearest = above.sort((a, b) => a.price - b.price)[0];
    if (!nearest) return { ok: false, reason: "NO_CLEARANCE_LEVEL" };
    return { ok: nearest.price - entry >= 0.10 * A, level: nearest.price };
  }
  const below = (swings.lows || []).filter((swing) => swing.price < entry);
  const nearest = below.sort((a, b) => b.price - a.price)[0];
  if (!nearest) return { ok: false, reason: "NO_CLEARANCE_LEVEL" };
  return { ok: entry - nearest.price >= 0.10 * A, level: nearest.price };
}
