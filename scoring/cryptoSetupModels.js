// Independent crypto setup models. A failed pattern does not fail the others.
// BTC, quote chase, spread, and the order book are not setup identity.

export const CRYPTO_SETUP_TYPES = Object.freeze([
  "BREAKOUT",
  "RETEST",
  "TREND_PULLBACK",
  "CONTINUATION",
  "COMPRESSION_BREAKOUT",
]);

const SETUP_REQUIREMENTS = Object.freeze({
  BREAKOUT: { minimumBars: 21, preferredBars: 24, lookback: 20, maximumGap: "ONE_INTERVAL" },
  RETEST: { minimumBars: 12, preferredBars: 24, lookback: 20, maximumGap: "ONE_INTERVAL" },
  TREND_PULLBACK: { minimumBars: 12, preferredBars: 24, lookback: 24, maximumGap: "ONE_INTERVAL" },
  CONTINUATION: { minimumBars: 12, preferredBars: 24, lookback: 20, maximumGap: "ONE_INTERVAL", extensionAtr: 3 },
  COMPRESSION_BREAKOUT: { minimumBars: 17, preferredBars: 24, lookback: 8, maximumGap: "ONE_INTERVAL" },
});

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

function round(value) {
  return Number.isFinite(value) ? Math.round(value) : null;
}

function evidence(name, state) {
  return { name, state };
}

function result(setupType, { state, required = [], supportive = [], reasons = [], extra = {} }) {
  const pieces = [...required, ...supportive];
  const known = pieces.filter((item) => item.state === "PASS" || item.state === "REJECT");
  const passed = pieces.filter((item) => item.state === "PASS").length;
  return {
    setupType,
    state,
    score: state === "DATA_UNAVAILABLE" ? null : round(pieces.length ? (passed / pieces.length) * 100 : null),
    coverage: pieces.length ? Number((known.length / pieces.length).toFixed(2)) : 0,
    requiredEvidence: Object.fromEntries(required.map((item) => [item.name, item.state])),
    supportiveEvidence: Object.fromEntries(supportive.map((item) => [item.name, item.state])),
    reasons,
    requirements: SETUP_REQUIREMENTS[setupType],
    ...extra,
  };
}

function decide(required, historyReady, historyReason) {
  if (!historyReady) return { state: "DATA_UNAVAILABLE", reasons: [historyReason] };
  if (required.some((item) => item.state === "DATA_UNAVAILABLE")) {
    return { state: "DATA_UNAVAILABLE", reasons: required.filter((item) => item.state === "DATA_UNAVAILABLE").map((item) => item.name) };
  }
  const failed = required.filter((item) => item.state !== "PASS");
  if (failed.length) return { state: "REJECT", reasons: failed.map((item) => item.name) };
  return { state: "PASS", reasons: [] };
}

function atrOf(rows) {
  const window = rows.slice(-14);
  return mean(window.map((bar, index) => {
    const prev = rows[rows.length - window.length - 1 + index]?.close ?? bar.open;
    return Math.max(bar.high - bar.low, Math.abs(bar.high - prev), Math.abs(bar.low - prev));
  }));
}

function swings(rows) {
  const highs = [];
  const lows = [];
  const start = Math.max(1, rows.length - 24);
  for (let index = start; index < rows.length - 1; index += 1) {
    if (rows[index].high > rows[index - 1].high && rows[index].high >= rows[index + 1].high) highs.push(rows[index].high);
    if (rows[index].low < rows[index - 1].low && rows[index].low <= rows[index + 1].low) lows.push(rows[index].low);
  }
  return {
    higherHighs: highs.length >= 2 && highs.at(-1) > highs.at(-2),
    higherLows: lows.length >= 2 && lows.at(-1) > lows.at(-2),
    lastHigherLow: lows.length ? lows.at(-1) : null,
    priorHigherLow: lows.length >= 2 ? lows.at(-2) : null,
  };
}

function dollars(bar) {
  return bar.volume * bar.close;
}

function stopFor(rows, atr, price) {
  const stopPrice = Math.min(...rows.slice(-5).map((bar) => bar.low)) - atr * 0.1;
  const valid = stopPrice > 0 && price > stopPrice;
  return { stopPrice, valid };
}

export function measureCryptoExhaustion(rows) {
  if (!Array.isArray(rows) || rows.length < 6) return { exhausted: false, reason: null };
  const last = rows.at(-1);
  const baseline = mean(rows.slice(-21, -1).map(dollars));
  const ratio = baseline > 0 ? dollars(last) / baseline : 0;
  const range = last.high - last.low;
  const closePosition = range > 0 ? (last.close - last.low) / range : 1;
  const exhausted = ratio >= 4 && closePosition < 0.4;
  return { exhausted, reason: exhausted ? "EXHAUSTION" : null, volumeRatio: ratio, closePosition };
}

function findBreak(rows) {
  if (rows.length < 8) return null;
  for (let index = 6; index < rows.length - 1; index += 1) {
    const base = rows.slice(Math.max(0, index - 10), index);
    if (base.length < 5) continue;
    const level = Math.max(...base.map((bar) => bar.high));
    if (rows[index].close > level) return { index, level, bar: rows[index] };
  }
  return null;
}

function evaluateBreakout(rows, price, context) {
  const needs = SETUP_REQUIREMENTS.BREAKOUT;
  const historyReady = rows.length >= needs.minimumBars;
  if (!historyReady) {
    return result("BREAKOUT", decide([], false, "BREAKOUT_HISTORY_UNAVAILABLE"));
  }
  const last = rows.at(-1);
  const lookback = rows.slice(-needs.lookback - 1, -1);
  const resistance = Math.max(...lookback.map((bar) => bar.high));
  const baseline = mean(lookback.map(dollars));
  const ratio = baseline > 0 ? dollars(last) / baseline : 0;
  const range = last.high - last.low;
  const closeHeld = range <= 0 || (last.close - last.low) / range >= 0.5;
  const required = [
    evidence("closeAboveHigh", last.close > resistance ? "PASS" : "REJECT"),
    evidence("breakoutStructure", last.close > resistance && closeHeld ? "PASS" : "REJECT"),
    evidence("breakBarVolume", last.volume > 0 && ratio >= 1.3 ? "PASS" : "REJECT"),
    evidence("stop", context.stop.valid ? "PASS" : "REJECT"),
    evidence("notExhausted", context.exhausted ? "REJECT" : "PASS"),
  ];
  const supportive = [
    evidence("higherLows", context.swings.higherLows ? "PASS" : "REJECT"),
    evidence("threeBarMomentum", context.roc > 0 ? "PASS" : "REJECT"),
  ];
  const decision = decide(required, true);
  return result("BREAKOUT", { ...decision, required, supportive, extra: { resistance, volumeRatio: ratio } });
}

function evaluateRetest(rows, price, context) {
  const historyReady = rows.length >= SETUP_REQUIREMENTS.RETEST.minimumBars;
  if (!historyReady) return result("RETEST", decide([], false, "RETEST_HISTORY_UNAVAILABLE"));
  const prior = findBreak(rows);
  if (!prior) {
    const required = [evidence("priorBreak", "REJECT"), evidence("breakoutLevel", "REJECT"), evidence("tagOfLevel", "REJECT"), evidence("reclaim", "REJECT"), evidence("stop", context.stop.valid ? "PASS" : "REJECT"), evidence("structureIntact", "REJECT")];
    return result("RETEST", { ...decide(required, true), required, supportive: [] });
  }
  const after = rows.slice(prior.index + 1);
  const tolerance = Math.max(context.atr * 0.25, prior.level * 0.001);
  const tagged = after.some((bar) => bar.low <= prior.level + tolerance && bar.low >= prior.level - tolerance);
  const last = rows.at(-1);
  const reclaimed = last.close > prior.level && last.close > rows.at(-2).close;
  const tagBars = after.slice(0, -1);
  const lighter = tagBars.length > 0 && mean(tagBars.map(dollars)) < dollars(prior.bar);
  const required = [
    evidence("priorBreak", "PASS"),
    evidence("breakoutLevel", Number.isFinite(prior.level) ? "PASS" : "REJECT"),
    evidence("tagOfLevel", tagged ? "PASS" : "REJECT"),
    evidence("reclaim", reclaimed ? "PASS" : "REJECT"),
    evidence("stop", context.stop.valid ? "PASS" : "REJECT"),
    evidence("structureIntact", last.close > prior.level ? "PASS" : "REJECT"),
  ];
  const supportive = [
    evidence("volumeDryUp", lighter ? "PASS" : "REJECT"),
    evidence("momentum", context.roc > 0 ? "PASS" : "REJECT"),
  ];
  return result("RETEST", { ...decide(required, true), required, supportive, extra: { level: prior.level } });
}

function evaluatePullback(rows, price, context) {
  const historyReady = rows.length >= SETUP_REQUIREMENTS.TREND_PULLBACK.minimumBars;
  if (!historyReady) return result("TREND_PULLBACK", decide([], false, "PULLBACK_HISTORY_UNAVAILABLE"));
  const { higherLows, lastHigherLow, priorHigherLow } = context.swings;
  const last = rows.at(-1);
  const recentHigh = Math.max(...rows.slice(-8, -1).map((bar) => bar.high));
  const pulledBack = last.close < recentHigh && (lastHigherLow === null || last.low >= lastHigherLow);
  const intact = higherLows && lastHigherLow !== null && priorHigherLow !== null && lastHigherLow > priorHigherLow && last.low >= lastHigherLow;
  const catastrophic = lastHigherLow !== null && last.low < lastHigherLow;
  const turned = last.close > rows.at(-2).close;
  const required = [
    evidence("establishedUptrend", higherLows ? "PASS" : "REJECT"),
    evidence("higherLowIntact", intact ? "PASS" : "REJECT"),
    evidence("pullbackContained", pulledBack && !catastrophic ? "PASS" : "REJECT"),
    evidence("sellingNotCatastrophic", catastrophic ? "REJECT" : "PASS"),
    evidence("turnTrigger", turned ? "PASS" : "REJECT"),
  ];
  const supportive = [
    evidence("threeBarMomentum", context.roc > 0 ? "PASS" : "REJECT"),
  ];
  return result("TREND_PULLBACK", { ...decide(required, true), required, supportive });
}

function evaluateContinuation(rows, price, context) {
  const historyReady = rows.length >= SETUP_REQUIREMENTS.CONTINUATION.minimumBars;
  if (!historyReady) return result("CONTINUATION", decide([], false, "CONTINUATION_HISTORY_UNAVAILABLE"));
  const prior = findBreak(rows);
  const last = rows.at(-1);
  const level = prior?.level ?? null;
  const above = level !== null && price > level && last.close > level;
  const extensionAtr = level !== null && context.atr > 0 ? (price - level) / context.atr : null;
  const withinTolerance = extensionAtr !== null && extensionAtr <= SETUP_REQUIREMENTS.CONTINUATION.extensionAtr;
  const range = prior ? level - Math.min(...rows.slice(Math.max(0, prior.index - 10), prior.index).map((bar) => bar.low)) : 0;
  const staleTarget = prior ? price > level + Math.max(range, 0) : false;
  const required = [
    evidence("priorBreakout", prior ? "PASS" : "REJECT"),
    evidence("aboveStructure", above ? "PASS" : "REJECT"),
    evidence("trendIntact", context.swings.higherLows || above ? "PASS" : "REJECT"),
    evidence("notExhausted", context.exhausted ? "REJECT" : "PASS"),
    evidence("extensionTolerance", withinTolerance ? "PASS" : "REJECT"),
    evidence("continuationTrigger", last.close > rows.at(-2).close ? "PASS" : "REJECT"),
  ];
  const supportive = [
    evidence("higherHighs", context.swings.higherHighs ? "PASS" : "REJECT"),
  ];
  const decision = decide(required, true);
  const reasons = staleTarget && decision.state === "PASS"
    ? ["TARGET_REASSESSMENT_REQUIRED"]
    : decision.reasons;
  return result("CONTINUATION", {
    ...decision,
    reasons,
    required,
    supportive,
    extra: { targetReassessment: staleTarget, extensionAtr },
  });
}

function evaluateCompression(rows, price, context) {
  const needs = SETUP_REQUIREMENTS.COMPRESSION_BREAKOUT;
  const historyReady = rows.length >= needs.minimumBars;
  if (!historyReady) return result("COMPRESSION_BREAKOUT", decide([], false, "COMPRESSION_HISTORY_UNAVAILABLE"));
  const compressed = rows.slice(-9, -1);
  const earlier = rows.slice(-17, -9);
  const last = rows.at(-1);
  const compressedRange = Math.max(...compressed.map((bar) => bar.high)) - Math.min(...compressed.map((bar) => bar.low));
  const earlierRange = earlier.length ? Math.max(...earlier.map((bar) => bar.high)) - Math.min(...earlier.map((bar) => bar.low)) : compressedRange;
  const boundary = Math.max(...compressed.map((bar) => bar.high));
  const compressedAtr = mean(compressed.map((bar) => bar.high - bar.low));
  const tight = context.atr > 0 && compressedRange <= context.atr * 2;
  const contracted = compressedRange < earlierRange;
  const broke = last.close > boundary;
  const expanded = last.high - last.low > compressedAtr;
  const participation = dollars(last) > mean(compressed.map(dollars));
  const required = [
    evidence("compressedRange", tight ? "PASS" : "REJECT"),
    evidence("volatilityContracted", contracted ? "PASS" : "REJECT"),
    evidence("boundary", Number.isFinite(boundary) ? "PASS" : "DATA_UNAVAILABLE"),
    evidence("closeBreaksBoundary", broke ? "PASS" : "REJECT"),
    evidence("rangeExpands", expanded ? "PASS" : "REJECT"),
    evidence("participationVsCompression", participation ? "PASS" : "REJECT"),
  ];
  return result("COMPRESSION_BREAKOUT", { ...decide(required, true), required, supportive: [], extra: { boundary } });
}

export function assessCryptoSetupModels(rows = [], price = null) {
  const usablePrice = Number(price);
  if (!Array.isArray(rows) || rows.length === 0 || !(usablePrice > 0)) {
    const empty = Object.fromEntries(CRYPTO_SETUP_TYPES.map((setupType) => [setupType, result(setupType, decide([], false, "CRYPTO_SETUP_HISTORY_UNAVAILABLE"))]));
    return {
      candidates: empty,
      selectedSetup: null,
      exhausted: false,
      entryTiming: null,
      available: false,
    };
  }
  const atr = atrOf(rows);
  const last = rows.at(-1);
  const context = {
    atr,
    roc: (last.close / rows.at(-4)?.close - 1) * 100,
    swings: swings(rows),
    stop: stopFor(rows, atr, usablePrice),
    exhausted: measureCryptoExhaustion(rows).exhausted,
  };
  const candidates = {
    BREAKOUT: evaluateBreakout(rows, usablePrice, context),
    RETEST: evaluateRetest(rows, usablePrice, context),
    TREND_PULLBACK: evaluatePullback(rows, usablePrice, context),
    CONTINUATION: evaluateContinuation(rows, usablePrice, context),
    COMPRESSION_BREAKOUT: evaluateCompression(rows, usablePrice, context),
  };
  if (context.exhausted) {
    for (const setupType of CRYPTO_SETUP_TYPES) {
      if (candidates[setupType].state === "DATA_UNAVAILABLE") continue;
      candidates[setupType] = {
        ...candidates[setupType],
        state: "REJECT",
        reasons: ["EXHAUSTION", ...candidates[setupType].reasons.filter((reason) => reason !== "EXHAUSTION")],
      };
    }
  }
  const ranked = CRYPTO_SETUP_TYPES
    .filter((setupType) => candidates[setupType].state === "PASS")
    .sort((left, right) => {
      const scoreGap = Number(candidates[right].score || 0) - Number(candidates[left].score || 0);
      if (scoreGap !== 0) return scoreGap;
      return CRYPTO_SETUP_TYPES.indexOf(left) - CRYPTO_SETUP_TYPES.indexOf(right);
    });
  const chased = Number.isFinite(atr) && atr > 0 && usablePrice > last.close + atr;
  return {
    candidates,
    selectedSetup: ranked[0] || null,
    exhausted: context.exhausted,
    entryTiming: chased ? "CHASED" : "TIMELY",
    available: true,
    atr,
    stopPrice: context.stop.stopPrice,
    higherHighs: context.swings.higherHighs,
    higherLows: context.swings.higherLows,
  };
}
