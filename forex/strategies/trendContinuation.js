import { atrBeforeWindow } from "../indicators.js";
import { isFourHourUptrend, isFourHourDowntrend } from "./breakoutRetest.js";
import { latestConfirmedSwings, risingStructure } from "../swings.js";

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

function completed(candles = []) {
  return candles.filter((candle) => candle && candle.complete !== false);
}

export function evaluateTrendContinuation({ h1 = [], m15 = [], h4 = [], side = "buy", previous } = {}) {
  const hours = completed(h1);
  const minutes = completed(m15);
  const strategyId = "FOREX_TREND_CONTINUATION_V1";
  if (hours.length < 30 || minutes.length < 16) {
    return { status: "NONE", stage: "DISCOVERED", reason: "INSUFFICIENT_CANDLES", strategyId };
  }
  const trendOk = side === "buy" ? isFourHourUptrend(h4) : isFourHourDowntrend(h4);
  if (!trendOk) {
    return { status: "NONE", stage: "DISCOVERED", reason: "FOUR_HOUR_TREND_FAIL", strategyId };
  }
  const at = hours.length - 1;
  const swings = latestConfirmedSwings(hours, at);
  const fallingHighs = (swings.highs || []).length >= 2
    && swings.highs[swings.highs.length - 1].price < swings.highs[swings.highs.length - 2].price;
  const fallingLows = (swings.lows || []).length >= 2
    && swings.lows[swings.lows.length - 1].price < swings.lows[swings.lows.length - 2].price;
  const structureOk = side === "buy"
    ? risingStructure(swings.highs) && risingStructure(swings.lows)
    : fallingHighs && fallingLows;
  if (!structureOk) {
    return { status: "NONE", stage: "DISCOVERED", reason: "HOUR_STRUCTURE_FAIL", strategyId };
  }
  const prior = previous?.frozen?.pullbackStart && !["EXPIRED", "INVALIDATED", "ORDER_INTENT_CREATED"].includes(previous.state) ? previous.frozen : null;
  const support = prior?.support ?? (side === "buy" ? swings.lastLow?.price : swings.lastHigh?.price);
  const A = prior?.A ?? (atrBeforeWindow(hours, hours.length, 14) || atrBeforeWindow(hours, hours.length - 1, 14));
  if (!Number.isFinite(A) || A <= 0 || !Number.isFinite(support)) {
    return { status: "NONE", stage: "DISCOVERED", reason: "ATR_UNAVAILABLE", strategyId };
  }
  const pre = minutes.slice(-12, -4);
  const after = prior ? minutes.filter(row => Date.parse(row.t) >= Date.parse(prior.pullbackStart)) : minutes.slice(-1);
  if (pre.length < 8 || after.length < 1) {
    return { status: "NONE", stage: "DISCOVERED", reason: "INSUFFICIENT_CANDLES", strategyId };
  }
  const reference = prior?.reference ?? (side === "buy"
    ? Math.max(...pre.map((row) => num(row.h)))
    : Math.min(...pre.map((row) => num(row.l))));
  const last = minutes[minutes.length - 1];
  const retreat = side === "buy" ? reference - num(last.l) : num(last.h) - reference;
  const aboveSupport = side === "buy" ? num(last.l) > support : num(last.h) < support;
  if (!aboveSupport || retreat > 1.5 * A) {
    return { status: "INVALIDATED", stage: "INVALIDATED", reason: "SUPPORT_BREACH", strategyId, frozen: { A, support, reference } };
  }
  if (!prior && retreat < 0.5 * A) {
    return { status: "CANDIDATE", stage: "WATCHING", reason: "TREND", strategyId, frozen: { A, support, reference }, executionAuthorization: "None" };
  }
  const frozen = { A, support, reference, side, pullbackStart: prior?.pullbackStart || last.t,
    stopAnchor: prior?.stopAnchor ?? (side === "buy" ? Math.min(...pre.slice(-4).map(row => num(row.l))) : Math.max(...pre.slice(-4).map(row => num(row.h)))) };
  if (after.length > 4) return { status: "INVALIDATED", stage: "EXPIRED", reason: "ENTRY_EXPIRED", strategyId, frozen };
  const priorTwoHigh = Math.max(num(minutes.at(-2)?.h), num(minutes.at(-3)?.h));
  const priorTwoLow = Math.min(num(minutes.at(-2)?.l), num(minutes.at(-3)?.l));
  const trigger = side === "buy"
    ? num(last.c) > priorTwoHigh + 0.05 * A
    : num(last.c) < priorTwoLow - 0.05 * A;
  if (!trigger) {
    if (after.length >= 4) {
      return { status: "INVALIDATED", stage: "EXPIRED", reason: "ENTRY_EXPIRED", strategyId, frozen };
    }
    return {
      status: "CANDIDATE",
      stage: "WATCHING",
      reason: "PULLBACK",
      strategyId,
      frozen,
      passed: ["Trend", "Pullback"],
      pending: ["Entry trigger"],
      executionAuthorization: "None",
    };
  }
  const stop = side === "buy"
    ? Math.min(frozen.stopAnchor, ...after.map((row) => num(row.l))) - 0.10 * A
    : Math.max(frozen.stopAnchor, ...after.map((row) => num(row.h))) + 0.10 * A;
  return {
    status: "CANDIDATE",
    stage: "WATCHING",
    reason: "ENTRY_TRIGGER",
    confirmedAt: new Date(Date.parse(last.t) + 900000).toISOString(),
    confirmationPrice: num(last.c),
    strategyId,
    frozen,
    stop,
    passed: ["Trend", "Pullback", "Trigger"],
    pending: ["Strategy approval"],
    executionAuthorization: "None",
  };
}
