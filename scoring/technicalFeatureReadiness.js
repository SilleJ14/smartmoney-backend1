// Minimum bars decide whether a feature exists. Ideal bars are diagnostic
// only. Twenty bars of history do not make MACD available.

export const TECHNICAL_FEATURE_READINESS = Object.freeze({
  RSI: Object.freeze({ minimumBars: 14, idealBars: 30 }),
  EMA9: Object.freeze({ minimumBars: 20, idealBars: 40 }),
  EMA20: Object.freeze({ minimumBars: 20, idealBars: 40 }),
  MACD: Object.freeze({ minimumBars: 34, idealBars: 50 }),
  MACD_SIGNAL: Object.freeze({ minimumBars: 34, idealBars: 50 }),
});

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function assessOne(name, spec, barCount, value) {
  const measured = finite(value);
  if (barCount < spec.minimumBars) {
    return {
      name,
      minimumBars: spec.minimumBars,
      idealBars: spec.idealBars,
      value: null,
      state: "DATA_UNAVAILABLE",
      reason: `${name}_REQUIRES_${spec.minimumBars}_BARS`,
      idealMet: false,
    };
  }
  if (measured === null) {
    return {
      name,
      minimumBars: spec.minimumBars,
      idealBars: spec.idealBars,
      value: null,
      state: "DATA_UNAVAILABLE",
      reason: `${name}_UNAVAILABLE`,
      idealMet: false,
    };
  }
  return {
    name,
    minimumBars: spec.minimumBars,
    idealBars: spec.idealBars,
    value: measured,
    state: "AVAILABLE",
    reason: null,
    idealMet: barCount >= spec.idealBars,
  };
}

export function assessTechnicalFeatures({
  barCount = 0,
  rsi = null,
  ema9 = null,
  ema20 = null,
  macd = null,
  macdSignal = null,
} = {}) {
  const count = Math.max(0, Math.floor(Number(barCount) || 0));
  const features = {
    RSI: assessOne("RSI", TECHNICAL_FEATURE_READINESS.RSI, count, rsi),
    EMA9: assessOne("EMA9", TECHNICAL_FEATURE_READINESS.EMA9, count, ema9),
    EMA20: assessOne("EMA20", TECHNICAL_FEATURE_READINESS.EMA20, count, ema20),
    MACD: assessOne("MACD", TECHNICAL_FEATURE_READINESS.MACD, count, macd),
    MACD_SIGNAL: assessOne("MACD_SIGNAL", TECHNICAL_FEATURE_READINESS.MACD_SIGNAL, count, macdSignal),
  };
  const entries = Object.values(features);
  const availableFeatures = entries.filter((feature) => feature.state === "AVAILABLE").map((feature) => feature.name);
  const unavailableFeatures = entries.filter((feature) => feature.state !== "AVAILABLE").map((feature) => feature.name);
  const packageComplete = unavailableFeatures.length === 0;
  return {
    barsAvailable: count,
    features,
    availableFeatures,
    unavailableFeatures,
    coverage: Number((availableFeatures.length / entries.length).toFixed(2)),
    packageComplete,
    technicalsComplete: packageComplete,
    technicalReadinessForPolicy: {
      legacyEntry: features.MACD.state === "AVAILABLE" && features.MACD_SIGNAL.state === "AVAILABLE" ? "PASS" : "WAIT",
      idealBarsGate: false,
    },
  };
}
