import { conversionLossPerUnit } from "./instrumentSpecs.js";
import { isOpeningRisk } from "./identity.js";

export const FOREX_RISK_LIMITS = Object.freeze({
  plannedRiskPerTradePercent: 10,
  openPlusPendingPercent: 10,
  sameDirectionCurrencyPercent: 10,
  dailyLossTriggerPercent: 10,
  drawdownPausePercent: 10,
  marginBufferPercent: 20,
  gapShockAtr: 0.25,
  scaleInsDisabled: true,
});

export function sizingReference({ equity, dayStartEquity, cashFlowAdjustedDayStart }) {
  const current = Number(equity);
  const start = Number(cashFlowAdjustedDayStart ?? dayStartEquity);
  const values = [current, start].filter((value) => Number.isFinite(value) && value > 0);
  return values.length ? Math.min(...values) : 0;
}

export function permittedUnits({
  allowedRisk,
  worstEntry,
  stop,
  costAllowance = 0,
  conversionFactor = 1,
  instrument = {},
} = {}) {
  const lossPerUnit = conversionLossPerUnit({
    worstEntry,
    stop,
    conversionFactor,
    costAllowance,
  });
  if (!(allowedRisk > 0) || !(lossPerUnit > 0)) return 0;
  const raw = Math.floor(allowedRisk / lossPerUnit);
  const min = Number(instrument.minimumTradeSize || 1);
  const precision = Number(instrument.tradeUnitsPrecision ?? 0);
  const increment = precision > 0 ? 10 ** -precision : 1;
  const stepped = Math.floor(raw / increment) * increment;
  const maxUnits = Number(instrument.maximumOrderUnits || 0);
  let units = stepped < min ? 0 : stepped;
  if (maxUnits > 0) units = Math.min(units, maxUnits);
  return units;
}

export function canOpenRisk({ effect, remainingDailyRisk, plannedRisk, openPlusPending, sameDirection, limits = FOREX_RISK_LIMITS }) {
  if (limits.scaleInsDisabled && effect === "INCREASING") return { ok: false, reason: "SCALE_IN_DISABLED" };
  if (!isOpeningRisk(effect) && effect !== "REDUCING" && effect !== "CLOSING") {
    return { ok: false, reason: "UNKNOWN_POSITION_EFFECT" };
  }
  if (!isOpeningRisk(effect)) return { ok: true };
  if (![remainingDailyRisk, plannedRisk, openPlusPending, sameDirection].every(value => typeof value === "number" && Number.isFinite(value) && value >= 0)
    || plannedRisk <= 0) return { ok: false, reason: "RISK_EVIDENCE_UNAVAILABLE" };
  if (plannedRisk > remainingDailyRisk) return { ok: false, reason: "RISK_BUDGET_EXHAUSTED" };
  if (openPlusPending + plannedRisk > limits.openPlusPendingPercent) return { ok: false, reason: "RISK_BUDGET_EXHAUSTED" };
  if (sameDirection + plannedRisk > limits.sameDirectionCurrencyPercent) return { ok: false, reason: "RISK_BUDGET_EXHAUSTED" };
  return { ok: true };
}
