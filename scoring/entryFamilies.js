// Shadow Entry. Production still uses calculateEntryQualityScore and E >= 75.
// Each family turns its inputs into one score. Agreeing indicators raise
// coverage. They do not add a second pile of points.
// The equal-family blend is only a logging series for later calibration.

import { measureBarStructure } from "./setupStateClassifier.js";

export const ENTRY_FAMILY_NAMES = Object.freeze([
  "trend",
  "momentum",
  "structure",
  "volume",
  "volatility",
  "execution",
]);

export const MACD_READY_BARS = 34;
export const EMA_READY_BARS = 20;
export const RSI_READY_BARS = 14;

export const ENTRY_REQUIREMENTS = Object.freeze({
  REQUIRED: "REQUIRED",
  SUPPORTIVE: "SUPPORTIVE",
  MEASURED: "MEASURED",
  NOT_APPLICABLE: "NOT_APPLICABLE",
});

const REQUIRED = ENTRY_REQUIREMENTS.REQUIRED;
const SUPPORTIVE = ENTRY_REQUIREMENTS.SUPPORTIVE;
const MEASURED = ENTRY_REQUIREMENTS.MEASURED;

export const ENTRY_POLICY = Object.freeze({
  BREAKOUT: { trend: REQUIRED, momentum: REQUIRED, structure: REQUIRED, volume: REQUIRED, volatility: MEASURED, execution: REQUIRED },
  PULLBACK: { trend: REQUIRED, momentum: SUPPORTIVE, structure: REQUIRED, volume: SUPPORTIVE, volatility: REQUIRED, execution: REQUIRED },
  RETEST: { trend: REQUIRED, momentum: SUPPORTIVE, structure: REQUIRED, volume: SUPPORTIVE, volatility: MEASURED, execution: REQUIRED },
  CONTINUATION: { trend: REQUIRED, momentum: SUPPORTIVE, structure: REQUIRED, volume: SUPPORTIVE, volatility: MEASURED, execution: REQUIRED },
  REVERSAL: { trend: REQUIRED, momentum: REQUIRED, structure: REQUIRED, volume: SUPPORTIVE, volatility: MEASURED, execution: REQUIRED },
  IGNITION: { trend: SUPPORTIVE, momentum: REQUIRED, structure: REQUIRED, volume: REQUIRED, volatility: MEASURED, execution: REQUIRED },
});

const FAMILY_REQUIREMENTS = Object.freeze({
  BREAKOUT: { required: ["trend", "momentum", "structure", "volume", "execution"], measured: ["volatility"], supportive: [] },
  PULLBACK: { required: ["trend", "structure", "volatility", "execution"], measured: [], supportive: ["momentum", "volume"] },
  RETEST: { required: ["trend", "structure", "execution"], measured: ["volatility"], supportive: ["momentum", "volume"] },
  CONTINUATION: { required: ["trend", "structure", "execution"], measured: ["volatility"], supportive: ["momentum", "volume"] },
  REVERSAL: { required: ["trend", "momentum", "structure", "execution"], measured: ["volatility"], supportive: ["volume"] },
  IGNITION: { required: ["momentum", "structure", "volume", "execution"], measured: ["volatility"], supportive: ["trend"] },
});

function finite(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function round(value, places = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const factor = 10 ** places;
  return Math.round(number * factor) / factor;
}

function clamp(value) {
  return Math.max(0, Math.min(100, value));
}

function knownBoolean(value) {
  return value === true || value === false ? value : null;
}

function barCount(signal = {}) {
  const lengths = [signal.stockChartBars, signal.chartBars, signal.historicalBars, signal.dailyBars]
    .filter((rows) => Array.isArray(rows))
    .map((rows) => rows.length);
  const measured = lengths.length ? Math.max(...lengths) : null;
  const declared = finite(signal.technicalBarsFound, signal.confirmations?.barsFound);
  return measured ?? declared;
}

function ready(count, minimum) {
  return count === null || count >= minimum;
}

function barsOf(signal = {}) {
  return signal.stockChartBars || signal.chartBars || signal.historicalBars || signal.dailyBars || [];
}

function observation(id, score, extra = {}) {
  const known = Number.isFinite(score);
  return {
    id,
    score: known ? round(clamp(score)) : null,
    state: extra.state || (known ? "PRESENT" : "UNKNOWN"),
    reason: extra.reason || null,
  };
}

function summarize(name, observations, expected) {
  const scored = observations.filter((item) => Number.isFinite(item.score));
  const slots = Math.max(1, expected);
  const familyCoverage = observations.length === 0 && scored.length === 0
    ? 0
    : Math.min(1, scored.length / slots);
  const familyScore = scored.length
    ? round(scored.reduce((sum, item) => sum + item.score, 0) / scored.length)
    : null;
  return {
    family: name,
    familyScore,
    familyCoverage: round(familyCoverage, 4) ?? 0,
    state: familyScore === null ? "UNKNOWN" : familyCoverage + 1e-9 >= 1 ? "PRESENT" : "PARTIAL",
    inputs: observations,
  };
}

function trendFamily(signal, count, setup) {
  if (setup === "REVERSAL") return reversalTrend(signal);
  const technicals = signal.technicals || {};
  const ema9 = finite(technicals.ema9);
  const ema20 = finite(technicals.ema20);
  if (!ready(count, EMA_READY_BARS) || ema9 === null || ema20 === null) {
    return summarize("trend", [observation("ema9-vs-ema20", null, {
      reason: !ready(count, EMA_READY_BARS) ? "EMA_REQUIRES_20_BARS" : "EMA_UNAVAILABLE",
    })], 1);
  }
  const price = finite(signal.price, signal.current, signal.latestClose);
  const gap = price !== null && price > 0 ? (ema9 - ema20) / price : null;
  const score = gap === null ? (ema9 > ema20 ? 72 : 40) : 50 + gap * 2000;
  return summarize("trend", [observation("ema9-vs-ema20", score)], 1);
}

function reversalTrend(signal) {
  const reversal = signal.reversalStructure || {};
  const priorKnown = reversal.priorTrend === "BEARISH" || reversal.priorTrend === "BULLISH";
  const changing = reversal.trendWeakening === true || reversal.turn === true;
  if (!priorKnown && !changing) {
    return summarize("trend", [observation("trend-change", null, { reason: "PRIOR_TREND_UNAVAILABLE" })], 1);
  }
  if (priorKnown && changing) return summarize("trend", [observation("trend-change", 78)], 1);
  return summarize("trend", [observation("trend-change", 58)], 1);
}

function rsiQuality(rsi) {
  if (rsi >= 50 && rsi <= 68) return 88;
  if (rsi >= 45 && rsi < 50) return 70;
  if (rsi > 68 && rsi <= 78) return 64;
  if (rsi > 82) return 36;
  if (rsi < 35) return 32;
  return 55;
}

function momentumFamily(signal, count) {
  const technicals = signal.technicals || {};
  const rsiReady = ready(count, RSI_READY_BARS);
  const macdReady = ready(count, MACD_READY_BARS);
  const rsi = rsiReady ? finite(technicals.rsi) : null;
  const macd = macdReady ? finite(technicals.macd) : null;
  const macdSignal = macdReady ? finite(technicals.macdSignal) : null;
  const observations = [
    observation("rsi", rsi === null ? null : rsiQuality(rsi), rsi === null ? {
      reason: rsiReady ? "RSI_UNAVAILABLE" : "RSI_REQUIRES_14_BARS",
    } : {}),
    observation("macd", macd === null || macdSignal === null ? null : (macd > macdSignal ? 88 : macd < macdSignal ? 34 : 50), macd === null || macdSignal === null ? {
      reason: macdReady ? "MACD_UNAVAILABLE" : "MACD_REQUIRES_34_BARS",
    } : {}),
  ];
  return summarize("momentum", observations, 2);
}

function ignitionTrigger(signal) {
  const ignition = signal.ignitionStructure || {};
  return ignition.rangeBreak === true
    || ignition.vwapReclaim === true
    || ignition.openingRangeBreak === true
    || ignition.highOfRange === true
    || ignition.resistanceBreak === true;
}

function structureFamily(signal, structure) {
  const confirmations = signal.confirmations || {};
  const setup = signal.setupState || signal.discoveryScorecard?.setupState || "UNKNOWN";
  if (setup === "IGNITION") {
    return ignitionTrigger(signal)
      ? summarize("structure", [observation("ignition-trigger", 82)], 1)
      : summarize("structure", [observation("ignition-trigger", null, { reason: "STRUCTURE_UNAVAILABLE" })], 1);
  }
  if (setup === "PULLBACK") {
    const pullback = signal.pullbackStructure || {};
    const intact = pullback.levelUnbroken === true || pullback.trendIntact === true;
    return intact
      ? summarize("structure", [observation("pullback-inside-trend", 80)], 1)
      : summarize("structure", [observation("pullback-inside-trend", null, { reason: "STRUCTURE_UNAVAILABLE" })], 1);
  }
  if (setup === "REVERSAL") {
    const reversal = signal.reversalStructure || {};
    const turned = reversal.reclaimed === true || reversal.failedExtreme === true;
    return turned
      ? summarize("structure", [observation("reversal-reclaim", 80)], 1)
      : summarize("structure", [observation("reversal-reclaim", null, { reason: "STRUCTURE_UNAVAILABLE" })], 1);
  }
  const breakout = signal.breakoutStructure || {};
  const continuation = signal.continuationStructure || {};
  const aboveVwap = knownBoolean(confirmations.aboveVwap);
  const closeLocation = finite(confirmations.closeNearHighPercent, signal.runnerStageProfile?.closeNearHighPercent);
  const cleared = knownBoolean(breakout.clearedResistance);
  const derivedCleared = structure?.cleared === true ? true : structure?.cleared === false ? false : null;
  const levelCleared = cleared === null ? derivedCleared : cleared;
  const holding = knownBoolean(breakout.structureIntact);
  const holds = holding === null ? (structure?.holdsAboveBreak === true ? true : structure?.holdsAboveBreak === false ? false : null) : holding;
  const returned = knownBoolean(continuation.returnedToLevel);
  const supportHeld = knownBoolean(continuation.supportHeld);
  const observations = [];

  if (setup === "RETEST" || returned !== null || supportHeld !== null) {
    if (returned !== null || supportHeld !== null) {
      const heldRetest = returned === true && supportHeld === true;
      const failedRetest = returned === true && supportHeld === false;
      const score = heldRetest ? 84 : failedRetest ? 30 : 48;
      observations.push({
        ...observation("retest", score),
        absorbed: aboveVwap === null ? [] : ["vwap-side"],
      });
    }
  } else if (setup === "BREAKOUT" || levelCleared !== null) {
    if (levelCleared !== null) {
      const score = levelCleared && holds !== false ? 84 : levelCleared ? 52 : 32;
      observations.push(observation("breakout-level", score));
    }
  } else if (setup === "CONTINUATION" || continuation.higherStructure === true || continuation.trendIntact === true) {
    const higher = continuation.higherStructure === true
      || ((structure?.higherLows || 0) >= 2 && (structure?.higherHighs || 0) >= 2);
    const aboveSupport = continuation.holdsAboveBreak === true || structure?.holdsAboveBreak === true;
    if (higher || aboveSupport || continuation.trendIntact === true) {
      const score = higher && aboveSupport ? 82 : higher || aboveSupport ? 64 : 46;
      observations.push(observation("continuation-structure", score));
    }
  }

  const retestOwnsVwap = observations.some((item) => item.id === "retest");
  if (!retestOwnsVwap && aboveVwap !== null) {
    observations.push(observation("vwap-side", aboveVwap ? 74 : 36));
  }
  if (Number.isFinite(closeLocation)) {
    observations.push(observation("price-location", closeLocation));
  }
  const expected = setup === "BREAKOUT" ? 2 : setup === "CONTINUATION" ? 2 : 1;
  return summarize("structure", observations, Math.max(expected, observations.length > 0 ? 1 : expected));
}

function volumeFamily(signal, structure) {
  const relative = finite(
    signal.relativeVolume,
    signal.volumeRatio,
    signal.volumeWakeupRatio,
    signal.confirmations?.volumeSpikeRatio,
    structure?.volumeRatio
  );
  const acceleration = finite(signal.volumeAcceleration, signal.volumeVelocity);
  const observations = [];
  if (relative !== null) observations.push(observation("relative-volume", relativeVolumeQuality(relative)));
  else if (acceleration !== null) observations.push(observation("volume-acceleration", relativeVolumeQuality(acceleration)));
  return summarize("volume", observations, 1);
}

function relativeVolumeQuality(ratio) {
  if (ratio < 0.7) return 42;
  if (ratio < 1.2) return 62;
  if (ratio <= 2.5) return 80;
  if (ratio <= 4) return 74;
  return 40;
}

function volatilityFamily(structure, signal, setup) {
  if (setup === "PULLBACK") {
    const depth = finite(signal.pullbackStructure?.depthAtr);
    if (depth === null) {
      return summarize("volatility", [observation("pullback-depth-atr", null, { reason: "ATR_PULLBACK_UNAVAILABLE" })], 1);
    }
    const score = depth >= 0.4 && depth <= 2.2 ? 78 : 36;
    return summarize("volatility", [observation("pullback-depth-atr", score)], 1);
  }
  const ratio = structure?.olderRange > 0 && structure?.recentRange !== null
    ? structure.recentRange / structure.olderRange
    : null;
  const distance = finite(structure?.distanceAtr);
  const observations = [];
  if (ratio !== null) {
    const score = ratio >= 0.8 && ratio <= 1.6 ? 78
      : ratio > 1.6 && ratio <= 2.2 ? 70
        : ratio > 2.2 ? 36
          : 62;
    observations.push(observation("range-versus-baseline", score));
  }
  if (distance !== null) {
    const score = distance < 1.5 ? 76 : distance < 3.5 ? 64 : 34;
    observations.push(observation("distance-versus-atr", score));
  }
  return summarize("volatility", observations, observations.length > 1 ? 2 : 1);
}

function measuredSpread(signal = {}) {
  if (signal.spreadAvailable === false || signal.liveQuote?.spreadAvailable === false || signal.bookAvailable === false) {
    return null;
  }
  const liveBid = finite(signal.liveQuote?.bid);
  const liveAsk = finite(signal.liveQuote?.ask);
  if (liveBid !== null && liveAsk !== null && liveBid > 0 && liveAsk >= liveBid) {
    return ((liveAsk - liveBid) / ((liveAsk + liveBid) / 2)) * 100;
  }
  const bid = finite(signal.bid);
  const ask = finite(signal.ask);
  if (bid !== null && ask !== null && bid > 0 && ask >= bid) {
    return ((ask - bid) / ((ask + bid) / 2)) * 100;
  }
  const reported = finite(signal.spreadPercent);
  return reported !== null && reported >= 0 ? reported : null;
}

function executionFamily(signal) {
  const spread = measuredSpread(signal);
  if (spread === null) {
    return summarize("execution", [observation("spread", null, { reason: "BOOK_UNAVAILABLE" })], 1);
  }
  return summarize("execution", [observation("spread", 100 - (spread / 1) * 55)], 1);
}

function shadowAnalyticalRisk(signal) {
  const confirmations = signal.confirmations || {};
  const observations = [];
  if (confirmations.newsRisk === true) observations.push(observation("news-downside", 20));
  else if (confirmations.newsRisk === false && confirmations.newsRiskAvailable === true) {
    observations.push(observation("news-downside", 80));
  } else {
    observations.push(observation("news-downside", null, { reason: "NEWS_UNAVAILABLE" }));
  }
  const gap = finite(confirmations.gapUpPercent, signal.gapUpPercent);
  if (gap === null) observations.push(observation("gap", null, { reason: "GAP_UNAVAILABLE" }));
  else observations.push(observation("gap", 80 - Math.max(0, Math.abs(gap) - 2) * 4));
  const summary = summarize("analyticalRisk", observations.filter((item) => item.state === "PRESENT" || item.score !== null), Math.max(1, observations.filter((item) => item.score !== null).length || 1));
  const scored = observations.filter((item) => Number.isFinite(item.score));
  return {
    ...summary,
    familyScore: scored.length ? round(scored.reduce((sum, item) => sum + item.score, 0) / scored.length) : null,
    familyCoverage: round(scored.length / observations.length, 4) ?? 0,
    state: scored.length === 0 ? "UNKNOWN" : scored.length === observations.length ? "PRESENT" : "PARTIAL",
    inputs: observations,
    excludedSharedEntryFacts: ["rsi", "vwap", "relativeVolume", "spread", "atr"],
  };
}

function uncalibratedEntry(families) {
  const measured = ENTRY_FAMILY_NAMES
    .map((name) => families[name])
    .filter((family) => Number.isFinite(family.familyScore) && family.familyCoverage > 0);
  if (!measured.length) return null;
  const weight = measured.reduce((sum, family) => sum + family.familyCoverage, 0);
  const score = measured.reduce((sum, family) => sum + family.familyScore * family.familyCoverage, 0) / weight;
  return round(score);
}

function structureEvidence(setup, family) {
  const present = new Set((family.inputs || []).filter((item) => Number.isFinite(item.score)).map((item) => item.id));
  if (setup === "BREAKOUT") return present.has("breakout-level");
  if (setup === "RETEST") return present.has("retest");
  if (setup === "CONTINUATION") return present.has("continuation-structure");
  if (setup === "PULLBACK") return present.has("pullback-inside-trend");
  if (setup === "REVERSAL") return present.has("reversal-reclaim");
  if (setup === "IGNITION") return present.has("ignition-trigger");
  return false;
}

function familyApproval(setup, families) {
  const policy = FAMILY_REQUIREMENTS[setup] || null;
  if (!policy) {
    return {
      setup,
      required: [],
      supportive: [],
      measured: [],
      missing: [],
      shadowApproved: false,
      reason: "SETUP_REQUIREMENTS_UNSET",
    };
  }
  const enough = (name) => {
    const family = families[name];
    if (name === "structure") return structureEvidence(setup, family);
    return family.familyScore !== null && family.familyCoverage + 1e-9 >= 0.5;
  };
  const seen = (name) => families[name].familyScore !== null && families[name].familyCoverage > 0;
  const missing = [
    ...policy.required.filter((name) => !enough(name)),
    ...policy.measured.filter((name) => !seen(name)),
  ];
  return {
    setup,
    required: policy.required,
    supportive: policy.supportive,
    measured: policy.measured,
    missing,
    shadowApproved: missing.length === 0,
    reason: missing.length === 0 ? "FAMILY_REQUIREMENTS_MET" : "FAMILY_EVIDENCE_INCOMPLETE",
  };
}

export function scoreEntryFamilies(signal = {}, {
  oldEntry = null,
  oldApproved = null,
  oldComponents = [],
} = {}) {
  const count = barCount(signal);
  const structure = measureBarStructure(barsOf(signal), finite(signal.price, signal.current, signal.latestClose));
  const setup = signal.setupState || signal.discoveryScorecard?.setupState || "UNKNOWN";
  const families = {
    trend: trendFamily(signal, count, setup),
    momentum: momentumFamily(signal, count),
    structure: structureFamily(signal, structure),
    volume: volumeFamily(signal, structure),
    volatility: volatilityFamily(structure, signal, setup),
    execution: executionFamily(signal),
  };
  const approval = familyApproval(setup, families);
  const policy = ENTRY_POLICY[setup] || null;
  for (const name of ENTRY_FAMILY_NAMES) {
    families[name].requirement = policy?.[name] || ENTRY_REQUIREMENTS.NOT_APPLICABLE;
    families[name].score = families[name].familyScore;
    families[name].coverage = families[name].familyCoverage;
  }
  const applicable = ENTRY_FAMILY_NAMES.filter((name) => families[name].requirement !== ENTRY_REQUIREMENTS.NOT_APPLICABLE);
  const entryCoverage = applicable.length
    ? round(applicable.reduce((sum, name) => sum + families[name].familyCoverage, 0) / applicable.length)
    : 0;
  const requiredUnknown = approval.missing.some((name) => families[name].familyScore === null || families[name].familyCoverage === 0);
  const entryApproved = approval.shadowApproved === true && setup !== "EXHAUSTED" && setup !== "EXTENDED";
  return {
    mode: "LIVE",
    algorithm: "ENTRY_FAMILIES_LIVE_UNCALIBRATED_V1",
    replacesProductionEntry: false,
    controlsLiveApproval: true,
    productionEntryGate: 75,
    thresholdStatus: "NOT_CALIBRATED",
    blendMethod: "UNCALIBRATED_EQUAL_COVERAGE",
    familyWeights: null,
    oldEntry: finite(oldEntry),
    oldApproved: oldApproved === true,
    oldComponents: Array.isArray(oldComponents) ? oldComponents.map((item) => ({
      name: item.name,
      value: item.value ?? null,
      weight: item.weight ?? null,
      contribution: item.contribution ?? null,
    })) : [],
    setupType: setup,
    consideredPolicies: [setup],
    newLongEntryAllowed: setup !== "EXHAUSTED",
    E: uncalibratedEntry(families),
    newEntry: uncalibratedEntry(families),
    requiredEvidencePass: approval.shadowApproved === true,
    entryCoverage,
    entryApproved,
    evidenceGate: entryApproved
      ? { state: "PASS", reasons: [] }
      : requiredUnknown
        ? { state: "WAIT", reasons: ["REQUIRED_ENTRY_EVIDENCE_UNKNOWN"] }
        : { state: "FAIL", reasons: ["ENTRY_POLICY_FAILED"] },
    families,
    familyApproval: approval,
    analyticalRisk: shadowAnalyticalRisk(signal),
    liveAnalyticalRisk: {
      rsiTermRemoved: false,
      reason: "RISK_IN_F_AUDIT",
    },
    barCount: count,
    macdReady: count !== null && count >= MACD_READY_BARS,
    outcomes: {
      status: "UNCALIBRATED",
      windows: ["5m", "15m", "30m", "60m"],
      forwardReturn: { "5m": null, "15m": null, "30m": null, "60m": null },
    },
  };
}

export function attachEntryFamilyOutcome(shadow = {}, forwardReturn = {}) {
  return {
    ...shadow,
    outcomes: {
      status: "RECORDED",
      windows: ["5m", "15m", "30m", "60m"],
      forwardReturn: {
        "5m": finite(forwardReturn["5m"], forwardReturn.m5),
        "15m": finite(forwardReturn["15m"], forwardReturn.m15),
        "30m": finite(forwardReturn["30m"], forwardReturn.m30),
        "60m": finite(forwardReturn["60m"], forwardReturn.m60),
      },
    },
  };
}
