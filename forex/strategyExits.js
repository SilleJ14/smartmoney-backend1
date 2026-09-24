import { FOREX_SPEC } from "./forexSpec.js";

export function plannedStop({ side, sequenceLows, sequenceHighs, A }) {
  if (side === "buy") return Math.min(...sequenceLows) - 0.10 * A;
  return Math.max(...sequenceHighs) + 0.10 * A;
}

export function plannedTarget({ side, entry, stop, multiple = FOREX_SPEC.targetMultiple }) {
  const distance = Math.abs(Number(entry) - Number(stop));
  if (!(distance > 0)) return null;
  return side === "buy" ? Number(entry) + multiple * distance : Number(entry) - multiple * distance;
}

export function stopDistanceOk({ entry, stop, A, min = FOREX_SPEC.stopDistanceMinAtr, max = FOREX_SPEC.stopDistanceMaxAtr }) {
  const distance = Math.abs(Number(entry) - Number(stop));
  if (!(A > 0)) return false;
  return distance >= min * A && distance <= max * A;
}

export function entryExpired({ confirmedAt, now = Date.now(), lifetimeSeconds = FOREX_SPEC.entryLifetimeSeconds }) {
  const confirmed = Date.parse(confirmedAt);
  if (!Number.isFinite(confirmed) || !Number.isFinite(now) || !(lifetimeSeconds > 0)) return true;
  return confirmed > now || now - confirmed > lifetimeSeconds * 1000;
}

export function chasedAway({ side, confirmationPrice, currentPrice, A, maxAtr = FOREX_SPEC.maxAdverseEntryAtr }) {
  const move = side === "buy"
    ? Number(currentPrice) - Number(confirmationPrice)
    : Number(confirmationPrice) - Number(currentPrice);
  return move > maxAtr * Number(A);
}

export function holdExpired({ openedAt, now = Date.now(), maxHoldHours = FOREX_SPEC.maxHoldHours }) {
  return now - Date.parse(openedAt || 0) > maxHoldHours * 3600 * 1000;
}
