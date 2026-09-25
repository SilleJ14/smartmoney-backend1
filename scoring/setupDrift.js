import { isCryptoSignal } from "./canonicalSignalRank.js";
import { wilderAtr } from "../forex/indicators.js";

// One definition of "the setup price moved far enough to need a new decision."
// Quote refresh calls this. The reassessment queue calls this. Nothing else
// may keep a second percent cutoff.
//
// Initial coefficients are the researched starting point: one Wilder ATR(14)
// and 1.5 times a robust spread. Stock and crypto keep separate objects so
// later outcome data can change one without changing the other.
// The tick buffer of 2 is an initial calibration, not a fitted optimum:
// one tick is the venue minimum and can be bid-ask bounce, so the floor
// starts at the next tick. Recorded rescore outcomes should recalibrate it.

export const STOCK_SETUP_DRIFT = Object.freeze({
  atrPeriod: 14,
  atrMultiplier: 1,
  spreadMultiplier: 1.5,
  tickBufferTicks: 2,
  spreadSampleMinimum: 5,
  spreadSampleCap: 21,
});

export const CRYPTO_SETUP_DRIFT = Object.freeze({
  atrPeriod: 14,
  atrMultiplier: 1,
  spreadMultiplier: 1.5,
  tickBufferTicks: 2,
  // No single statutory crypto increment is configured. The tick floor stays
  // off until a venue increment is set here. It must not inherit the stock penny.
  tickSize: null,
  spreadSampleMinimum: 5,
  spreadSampleCap: 21,
});

const BAR_MS = { "1Min": 60000, "5Min": 300000, "15Min": 900000 };

export function setupDriftParameters(signal = {}) {
  return isCryptoSignal(signal) ? CRYPTO_SETUP_DRIFT : STOCK_SETUP_DRIFT;
}

// 17 CFR 242.612. On 2026-09-24 the amended $0.005 increment for some
// stocks at or above $1 is not in force yet. Quotes at or above $1 use $0.01.
// Quotes below $1 use $0.0001.
export function stockTickSize(price) {
  const value = Number(price);
  if (!(value > 0)) return null;
  return value >= 1 ? 0.01 : 0.0001;
}

export function nbboMidpoint(signal = {}) {
  const bid = Number(signal.bid);
  const ask = Number(signal.ask);
  if (!(bid > 0) || !(ask > 0) || ask < bid) return null;
  return { price: (bid + ask) / 2, type: "NBBO_MID", spread: ask - bid };
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

function rememberSpread(samples, spread, cap) {
  const prior = Array.isArray(samples) ? samples.filter((value) => Number(value) >= 0 && Number.isFinite(Number(value))) : [];
  if (!(Number(spread) >= 0) || !Number.isFinite(Number(spread))) return prior.slice(-cap);
  return [...prior, Number(spread)].slice(-cap);
}

function barTime(bar) {
  const raw = bar?.t ?? bar?.time ?? bar?.timestamp;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  const parsed = Date.parse(String(raw || ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function completedCandles(signal, now) {
  const interval = BAR_MS[String(signal.chartTimeframe || "")];
  const rows = (Array.isArray(signal.chartBars) ? signal.chartBars : []).map((bar) => {
    const close = Number(bar?.c ?? bar?.close);
    const high = Number(bar?.h ?? bar?.high);
    const low = Number(bar?.l ?? bar?.low);
    return {
      h: high,
      l: low,
      c: close,
      time: barTime(bar),
      complete: bar?.complete,
      intervalMs: Number(bar?.intervalMs),
    };
  }).filter((bar) => bar.h > 0 && bar.l > 0 && bar.c > 0 && bar.h >= bar.l);
  return rows.filter((bar) => {
    if (bar.complete === false) return false;
    if (bar.time == null) return false;
    const barInterval = interval || (bar.intervalMs > 0 ? bar.intervalMs : null);
    if (barInterval == null) return bar.complete === true;
    return bar.time <= now - barInterval;
  });
}

export function atr14(signal = {}, now = Date.now()) {
  const period = setupDriftParameters(signal).atrPeriod;
  const candles = completedCandles(signal, now);
  // Wilder ATR(period) needs `period` true ranges, which takes period + 1 completed bars.
  const computed = wilderAtr(candles, period);
  if (!computed || !(computed.atr > 0)) {
    return { ready: false, atr: null, completedBars: candles.length, requiredBars: period + 1 };
  }
  return { ready: true, atr: computed.atr, completedBars: candles.length, requiredBars: period + 1 };
}

function tickFloor(signal, price, parameters) {
  const ticks = Number(parameters.tickBufferTicks);
  if (!(ticks > 0)) return null;
  const size = isCryptoSignal(signal) ? parameters.tickSize : stockTickSize(price);
  if (!(Number(size) > 0)) return null;
  return ticks * Number(size);
}

function latched(signal) {
  return signal.rescoreStatus === "QUEUED" || signal.rescoreStatus === "RUNNING" || signal.setupRevalidationRequired === true;
}

function pendingFields(signal, now, driftAbs) {
  const already = signal.rescoreStatus === "QUEUED" || signal.rescoreStatus === "RUNNING";
  const triggeredAt = already && signal.rescoreTriggeredAt ? signal.rescoreTriggeredAt : new Date(now).toISOString();
  const maxDrift = Math.max(Number(signal.maxDriftSinceTrigger) || 0, Number(driftAbs) || 0);
  return {
    rescoreStatus: already ? signal.rescoreStatus : "QUEUED",
    rescoreReason: "SETUP_CHANGED",
    rescoreTriggeredAt: triggeredAt,
    rescoreReferencePrice: signal.rescoreReferencePrice ?? signal.decisionReferencePrice ?? null,
    maxDriftSinceTrigger: maxDrift,
    reassessmentEvent: signal.reassessmentEvent && already ? signal.reassessmentEvent : `setup-drift:${triggeredAt}`,
    reassessmentPriority: maxDrift > 0 && signal.rescoreDistance > 0 && maxDrift > signal.rescoreDistance * 2 ? 3 : 2,
    setupRevalidationRequired: false,
    setupDriftStatus: "RESCORE_REQUIRED",
    executionWaitReason: "SETUP_CHANGED_REASSESSMENT_PENDING",
  };
}

export function classifySetupOutcome(signal = {}, { previousReference = null } = {}) {
  const action = String(signal.centralAutonomousAction || signal.centralAutonomousDecisionCore?.action || "").toUpperCase();
  const allowed = ["ALLOW", "ALLOW_REDUCED_SIZE", "ACCELERATE_CAPITAL"].includes(action);
  if (signal.confirmations?.fakeBreakout === true) return "BROKEN_SETUP";
  if (signal.lateChaseRisk === true || signal.runnerStage === "EXHAUSTION") return "EXHAUSTED";
  if (signal.discoveryScorecard?.extensionProfile?.alreadyExtended === true) return "EXTENDED";
  if (signal.cryptoDiscoveryScorecard?.extension?.alreadyExtended === true) return "EXTENDED";
  const mid = nbboMidpoint(signal);
  const prior = Number(previousReference);
  if (allowed && mid && prior > 0 && mid.price < prior) return "BETTER_ENTRY";
  if (signal.continuationSetup?.eligible === true) return "CONTINUATION";
  return allowed ? "STILL_VALID" : "BROKEN_SETUP";
}

export function evaluateSetupDrift(signal = {}, { now = Date.now() } = {}) {
  const parameters = setupDriftParameters(signal);
  const book = nbboMidpoint(signal);
  const spreadReferenceSamples = rememberSpread(
    signal.spreadReferenceSamples,
    book ? book.spread : null,
    parameters.spreadSampleCap
  );
  const spreadReference = spreadReferenceSamples.length >= parameters.spreadSampleMinimum
    ? median(spreadReferenceSamples)
    : null;
  const carried = {
    spreadReferenceSamples,
    spreadReference,
    decisionReferencePrice: signal.decisionReferencePrice ?? null,
    decisionReferencePriceType: signal.decisionReferencePriceType || null,
    decisionReferenceTimestamp: signal.decisionReferenceTimestamp || null,
  };

  if (!book) {
    if (latched(signal)) {
      return { ...carried, ...pendingFields(signal, now, signal.maxDriftSinceTrigger), executionWaitReason: "QUOTE_UNAVAILABLE" };
    }
    return {
      ...carried,
      setupDriftStatus: "QUOTE_UNAVAILABLE",
      executionWaitReason: "QUOTE_UNAVAILABLE",
      evidenceWaitReason: null,
      atrBackfillRequested: signal.atrBackfillRequested === true,
      rescoreStatus: signal.rescoreStatus === "RUNNING" ? "RUNNING" : "NONE",
    };
  }

  const volatility = atr14(signal, now);
  if (!volatility.ready) {
    if (latched(signal)) {
      return { ...carried, ...pendingFields(signal, now, Math.abs(book.price - Number(signal.decisionReferencePrice)) || 0), atrBackfillRequested: true };
    }
    // Spread-only distance is intentionally unused until ATR is ready.
    return {
      ...carried,
      setupDriftStatus: "WAIT_ATR",
      evidenceWaitReason: "PRICE_EVIDENCE_UNAVAILABLE",
      executionWaitReason: null,
      atrBackfillRequested: true,
      atrCompletedBars: volatility.completedBars,
      atrRequiredBars: volatility.requiredBars,
      rescoreStatus: "NONE",
      rescoreDistance: null,
    };
  }

  const referenceType = signal.decisionReferencePriceType;
  const reference = Number(signal.decisionReferencePrice);
  if (referenceType !== "NBBO_MID" || !(reference > 0)) {
    if (latched(signal)) return { ...carried, ...pendingFields(signal, now, signal.maxDriftSinceTrigger) };
    return {
      ...carried,
      setupDriftStatus: "WAIT_REFERENCE",
      evidenceWaitReason: null,
      executionWaitReason: null,
      atrBackfillRequested: false,
      atr: volatility.atr,
      rescoreStatus: "NONE",
    };
  }

  const driftAbs = Math.abs(book.price - reference);
  const floor = tickFloor(signal, book.price, parameters);
  const parts = [volatility.atr * parameters.atrMultiplier];
  if (spreadReference != null) parts.push(spreadReference * parameters.spreadMultiplier);
  if (floor != null) parts.push(floor);
  const rescoreDistance = Math.max(...parts);
  const base = {
    ...carried,
    atr: volatility.atr,
    atrCompletedBars: volatility.completedBars,
    driftAbs,
    rescoreDistance,
    tickFloor: floor,
    evidenceWaitReason: null,
    atrBackfillRequested: false,
  };

  if (latched(signal) || driftAbs > rescoreDistance) {
    const fields = pendingFields({ ...signal, rescoreDistance }, now, driftAbs);
    if (fields.maxDriftSinceTrigger > rescoreDistance * 2) fields.reassessmentPriority = 3;
    return { ...base, ...fields };
  }

  return {
    ...base,
    setupDriftStatus: "WITHIN_BAND",
    executionWaitReason: null,
    rescoreStatus: "NONE",
    rescoreReason: null,
    reassessmentPriority: 0,
  };
}
