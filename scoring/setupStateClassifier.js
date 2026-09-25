// What kind of setup this is. Discovery quality is a different fact.
// A large daily move is an input. It does not by itself lower D or choose the state.
// Setup drift remains a separate question: whether an authorized decision moved.

export const SETUP_STATES = Object.freeze([
  "EARLY",
  "BREAKOUT",
  "PULLBACK",
  "RETEST",
  "CONTINUATION",
  "REVERSAL",
  "IGNITION",
  "EXTENDED",
  "EXHAUSTED",
  "UNKNOWN",
]);

function finite(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function barsOf(rows = []) {
  return (Array.isArray(rows) ? rows : []).map((bar) => ({
    open: Number(bar.open ?? bar.o),
    high: Number(bar.high ?? bar.h),
    low: Number(bar.low ?? bar.l),
    close: Number(bar.close ?? bar.c),
    volume: Number(bar.volume ?? bar.v ?? 0),
  })).filter((bar) => bar.close > 0 && bar.high > 0 && bar.low > 0);
}

function average(values) {
  const clean = values.filter((value) => Number.isFinite(value));
  if (!clean.length) return null;
  return clean.reduce((sum, value) => sum + value, 0) / clean.length;
}

export function measureBarStructure(rows, price) {
  return deriveStructure(barsOf(rows), price);
}

function deriveStructure(rows, price) {
  if (rows.length < 10) return null;
  const last = rows.at(-1);
  const previous = rows.at(-2);
  const base = rows.slice(-21, -1);
  const recent = rows.slice(-6, -1);
  const older = rows.slice(-21, -6);
  const baseHigh = Math.max(...base.map((bar) => bar.high));
  const baseLow = Math.min(...base.map((bar) => bar.low));
  const rangePercent = (bar) => bar.close > 0 ? ((bar.high - bar.low) / bar.close) * 100 : 0;
  const recentRange = average(recent.map(rangePercent));
  const olderRange = average(older.map(rangePercent));
  const trueRanges = base.slice(1).map((bar, index) => {
    const priorClose = base[index].close;
    return Math.max(bar.high - bar.low, Math.abs(bar.high - priorClose), Math.abs(bar.low - priorClose));
  });
  const baselineAtr = average(trueRanges);
  const current = finite(price, last.close);
  const higherLows = recent.slice(1).filter((bar, index) => bar.low > recent[index].low).length;
  const higherHighs = recent.slice(1).filter((bar, index) => bar.high > recent[index].high).length;
  const baseVolume = average(base.slice(0, -1).map((bar) => bar.volume).filter((value) => value > 0));
  const volumeRatio = baseVolume > 0 ? last.volume / baseVolume : null;
  const dayChange = previous.close > 0 ? ((last.close - previous.close) / previous.close) * 100 : null;
  const first = rows.at(-21) || rows[0];
  const twentyDayChange = first.close > 0 && current > 0 ? ((current - first.close) / first.close) * 100 : null;
  const supportLow = recent.length ? Math.min(...recent.map((bar) => bar.low)) : baseLow;
  const distanceAtr = baselineAtr > 0 && current > 0 ? (current - supportLow) / baselineAtr : null;
  const cleared = current !== null && current >= baseHigh;
  const closePosition = last.high > last.low ? (last.close - last.low) / (last.high - last.low) : null;
  return {
    compressed: olderRange > 0 && recentRange !== null && recentRange < olderRange * 0.8,
    rangeExpanded: olderRange > 0 && recentRange !== null && last && rangePercent(last) > olderRange * 1.4,
    cleared,
    higherLows,
    higherHighs,
    volumeRatio,
    dayChange,
    twentyDayChange,
    distanceAtr,
    closePosition,
    baseHigh,
    holdsAboveBreak: current !== null && current >= baseHigh * 0.985,
    recentRange,
    olderRange,
    baselineAtr,
  };
}

function horizonChange(extension, days) {
  if (!extension) return null;
  const named = extension.changes?.[`day${days}`];
  if (named !== null && named !== undefined && Number.isFinite(Number(named))) return Number(named);
  const row = (extension.horizons || []).find((item) => item.days === days);
  return row && Number.isFinite(Number(row.changePercent)) ? Number(row.changePercent) : null;
}

function longerHorizonExtended(extension) {
  const day20 = horizonChange(extension, 20);
  const day5 = horizonChange(extension, 5);
  const flagged = (extension?.horizons || []).some((item) => item.days >= 20 && item.extended === true);
  return (day20 !== null && day20 >= 35) || (flagged && day20 !== null && day20 >= 25) || (day5 !== null && day5 >= 30 && day20 !== null && day20 >= 25);
}

export function setupStateFromSignal(signal = {}) {
  const confirmations = signal.confirmations || {};
  const technicals = signal.technicals || {};
  return classifySetupState({
    price: finite(signal.price, signal.current, signal.latestClose),
    percentChange: finite(signal.percentChange, signal.changePercent, signal.dayChangePercent),
    bars: signal.chartBars || signal.stockChartBars || signal.dailyBars || signal.history,
    volume: finite(signal.volume, signal.latestVolume),
    atr: finite(signal.atr14, signal.atr),
    relativeVolume: finite(signal.relativeVolume, signal.volumeRatio, signal.volumeWakeupRatio),
    extension: signal.multiHorizonExtension || signal.extension || signal.extensionProfile || null,
    historyDays: finite(
      signal.historyDays,
      signal.discoveryScorecard?.dataQuality?.completedValidDailyBars,
      signal.completedValidDailyBars
    ),
    extensionCoverage: finite(signal.extension?.coverage, signal.multiHorizonExtension?.coverage, signal.extensionProfile?.coverage),
    compressionScore: finite(signal.compressionScore, signal.preMoverCompressionScore),
    higherLowCount: finite(signal.higherLowCount),
    closeNearHighPercent: finite(confirmations.closeNearHighPercent, signal.closeNearHighPercent),
    aboveVwap: confirmations.aboveVwap,
    ema9: finite(technicals.ema9),
    ema20: finite(technicals.ema20),
    breakoutStructure: signal.breakoutStructure || null,
    continuationStructure: signal.continuationStructure || null,
    exhaustionEvidence: signal.exhaustionEvidence || null,
    runnerStage: signal.runnerStage,
    lateChaseRisk: signal.lateChaseRisk === true,
  });
}

export function setupEntryBlock(signal = {}) {
  const state = signal.setupState
    || signal.discoveryScorecard?.setupState
    || signal.cryptoDiscoveryScorecard?.setupState
    || null;
  if (state === "EXHAUSTED") return "EXHAUSTION";
  if (state === "EXTENDED") return "ENTRY_EXTENDED";
  return null;
}

function isPullback(input, freshBreakout, retest) {
  if (freshBreakout || retest) return false;
  const pullback = input.pullbackStructure || {};
  return pullback.trendIntact === true && finite(pullback.depthAtr) !== null;
}

function isReversal(input) {
  const reversal = input.reversalStructure || {};
  return reversal.priorTrend === "BEARISH" && (reversal.trendWeakening === true || reversal.turn === true);
}

function isIgnition(input, healthyContinuation) {
  if (healthyContinuation) return false;
  const ignition = input.ignitionStructure || {};
  const structural = ignition.rangeBreak === true
    || ignition.vwapReclaim === true
    || ignition.openingRangeBreak === true
    || ignition.highOfRange === true
    || ignition.resistanceBreak === true;
  return input.runnerStage === "IGNITION" || structural || ignition.claimed === true;
}

export function classifySetupState(input = {}) {
  const rows = barsOf(input.bars);
  const derived = deriveStructure(rows, input.price);
  const extension = input.extension || null;
  const historyDays = finite(input.historyDays);
  const coverage = finite(input.extensionCoverage, extension?.coverage);
  const extensionKnown = extension !== null && coverage !== null && coverage >= 1 && (historyDays === null || historyDays >= 21);
  const extensionEvidence = extensionKnown ? "KNOWN" : "UNKNOWN";
  const breakout = input.breakoutStructure || {};
  const continuation = input.continuationStructure || {};
  const exhaustion = input.exhaustionEvidence || {};
  const percentChange = finite(input.percentChange, derived?.dayChange);
  const relativeVolume = finite(input.relativeVolume, derived?.volumeRatio);
  const distance = finite(
    breakout.distanceFromSupportAtr,
    continuation.distanceFromSupportAtr,
    input.atr > 0 && input.price > 0 ? null : null,
    derived?.distanceAtr
  );
  const twentyDay = finite(continuation.twentyDayChange, breakout.twentyDayChange, derived?.twentyDayChange, horizonChange(extension, 20));
  const severeLong = longerHorizonExtended(extension) || (twentyDay !== null && twentyDay >= 35);
  const explicitBreakout = breakout.clearedResistance === true
    && breakout.volumeConfirmed !== false
    && breakout.structureIntact !== false
    && !severeLong;
  const derivedBreakout = derived?.cleared === true
    && derived.volumeRatio !== null && derived.volumeRatio >= 1.5
    && (derived.compressed || derived.rangeExpanded)
    && !severeLong;
  const freshBreakout = explicitBreakout || derivedBreakout;
  const stretched = severeLong || (distance !== null && distance >= 3.5 && !freshBreakout);
  const climax = exhaustion.climaxVolume === true || (relativeVolume !== null && relativeVolume >= 4) || (derived != null && derived.volumeRatio != null && derived.volumeRatio >= 4);
  const failedHold = exhaustion.failedHold === true
    || (finite(input.closeNearHighPercent) !== null && input.closeNearHighPercent < 40)
    || (derived != null && derived.closePosition != null && derived.closePosition < 0.4);
  const exhausted = input.lateChaseRisk === true
    || input.runnerStage === "EXHAUSTION"
    || exhaustion.parabolic === true
    || exhaustion.exhausted === true
    || (climax && (failedHold || exhaustion.parabolic === true || stretched));
  const retest = continuation.priorBreakout === true
    && continuation.returnedToLevel === true
    && continuation.supportHeld === true
    && continuation.reclaimed !== false
    && !stretched;
  const trendIntact = continuation.trendIntact === true
    || (derived?.higherHighs >= 2 && derived?.higherLows >= 2 && derived?.holdsAboveBreak === true)
    || (finite(input.ema9) !== null && finite(input.ema9) > finite(input.ema20) && input.aboveVwap === true);
  const healthyContinuation = trendIntact
    && continuation.holdsAboveBreak !== false
    && (continuation.higherStructure === true || (derived?.higherLows >= 2 && derived?.higherHighs >= 2))
    && !stretched
    && !climax;
  const quietBase = !exhausted && !stretched && !freshBreakout && !derivedBreakout && (
    (finite(input.compressionScore) !== null && input.compressionScore >= 60
      && (finite(input.higherLowCount) === null || input.higherLowCount >= 1)
      && (percentChange === null || Math.abs(percentChange) <= 6)
      && breakout.clearedResistance !== true)
    || (derived?.compressed === true && derived.cleared !== true && derived.higherLows >= 1
      && (percentChange === null || Math.abs(percentChange) <= 6))
  );

  let state = "UNKNOWN";
  const reasons = [];
  if (exhausted) {
    state = "EXHAUSTED";
    if (climax) reasons.push("CLIMAX_VOLUME");
    if (input.lateChaseRisk === true || input.runnerStage === "EXHAUSTION" || exhaustion.parabolic === true) reasons.push("PARABOLIC_OR_LATE_CHASE");
    if (failedHold) reasons.push("FAILED_HOLD");
  } else if (stretched && !freshBreakout) {
    state = "EXTENDED";
    if (distance !== null && distance >= 3.5) reasons.push("DISTANCE_FROM_SUPPORT");
    if (severeLong) reasons.push("MULTI_HORIZON_STRETCH");
  } else if (freshBreakout || derivedBreakout) {
    state = "BREAKOUT";
    if (freshBreakout || derived?.cleared) reasons.push("BASE_RESISTANCE_CLEARED");
    if (breakout.volumeConfirmed !== false && (relativeVolume === null || relativeVolume >= 1.5 || derived?.volumeRatio >= 1.5)) reasons.push("VOLUME_EXPANSION");
    if (breakout.rangeExpanded === true || derived?.rangeExpanded || derived?.compressed) reasons.push("RANGE_EXPANSION");
    if (!severeLong) reasons.push("MULTI_DAY_EXTENSION_ACCEPTABLE");
  } else if (retest) {
    state = "RETEST";
    reasons.push("RETURNED_TO_BREAKOUT", "SUPPORT_HELD");
    if (continuation.sellingContracted === true) reasons.push("SELLING_PRESSURE_CONTRACTED");
    if (continuation.reclaimed === true) reasons.push("RECLAIM_CONFIRMED");
  } else if (isPullback(input, freshBreakout, retest)) {
    state = "PULLBACK";
    reasons.push("TREND_INTACT", "ATR_PULLBACK");
  } else if (isReversal(input)) {
    state = "REVERSAL";
    reasons.push("PRIOR_TREND_IDENTIFIED", "TREND_WEAKENING");
  } else if (isIgnition(input, healthyContinuation)) {
    state = "IGNITION";
    reasons.push("MOMENTUM_IGNITION");
  } else if (quietBase) {
    state = "EARLY";
    reasons.push("INSIDE_OR_NEAR_BASE");
    if ((finite(input.compressionScore) !== null && input.compressionScore >= 60) || derived?.compressed) reasons.push("COMPRESSION");
    if ((finite(input.higherLowCount) || 0) >= 1 || (derived?.higherLows || 0) >= 1) reasons.push("HIGHER_LOWS");
  } else if (healthyContinuation && (continuation.trendIntact === true || continuation.higherStructure === true || derived?.holdsAboveBreak)) {
    state = "CONTINUATION";
    reasons.push("TREND_INTACT", "HIGHER_STRUCTURE");
    if (derived?.holdsAboveBreak || continuation.holdsAboveBreak === true) reasons.push("HOLDS_ABOVE_BREAK");
  }
  if (extensionEvidence === "UNKNOWN") reasons.push("EXTENSION_EVIDENCE_UNKNOWN");
  const present = [
    finite(input.price, derived?.baseHigh) !== null,
    relativeVolume !== null || rows.length >= 10,
    extensionKnown,
    state !== "UNKNOWN",
  ].filter(Boolean).length;
  return {
    state,
    confidence: Number(Math.min(0.95, 0.4 + reasons.filter((reason) => reason !== "EXTENSION_EVIDENCE_UNKNOWN").length * 0.15).toFixed(2)),
    reasons,
    evidenceCoverage: Number((present / 4).toFixed(2)),
    extensionEvidence,
    earlyEntryEligible: state === "EARLY",
    newLongEntryAllowed: state !== "EXHAUSTED",
  };
}
