import { isUsStockMarketSessionDayKey } from "../utils/usMarketCalendar.js";

const MAX_TRACKED_SESSIONS = 20;

function boundedSessionCount(value, completedSessionCount) {
  return Math.min(
    Math.max(0, Number(value || 0)),
    Math.max(0, completedSessionCount)
  );
}

export function updateStockContinuationSession(
  previous = {},
  {
    dayKey,
    accumulationEvent = false,
    stealthVolumeEvent = false,
    supportHoldEvent = false,
    failedBreakoutEvent = false,
  } = {}
) {
  const normalizedDayKey = String(dayKey || "").trim();
  const priorSeenDays = [
    ...new Set(
      (Array.isArray(previous.seenDays) ? previous.seenDays : [])
        .map((value) => String(value || "").trim())
        .filter((value) => isUsStockMarketSessionDayKey(value) && value <= normalizedDayKey &&
          Date.parse(normalizedDayKey) - Date.parse(value) <= 35 * 86400000)
    ),
  ].slice(-MAX_TRACKED_SESSIONS);
  const priorSessionEvidence = (Array.isArray(previous.sessionEvidence)
    ? previous.sessionEvidence
    : [])
    .filter((item) => priorSeenDays.includes(item?.dayKey))
    .slice(-MAX_TRACKED_SESSIONS)
    .map((item) => ({
      dayKey: item.dayKey,
      accumulationEvent: item.accumulationEvent === true,
      stealthVolumeEvent: item.stealthVolumeEvent === true,
      supportHoldEvent: item.supportHoldEvent === true,
      failedBreakoutEvent: item.failedBreakoutEvent === true,
    }));
  const validSession = isUsStockMarketSessionDayKey(normalizedDayKey);
  const isNewSession =
    validSession && !priorSeenDays.includes(normalizedDayKey);
  const priorSessionCount = priorSeenDays.length;
  const seenDays = isNewSession
    ? [...priorSeenDays, normalizedDayKey].slice(-MAX_TRACKED_SESSIONS)
    : priorSeenDays;
  const priorCurrentEvidence = priorSessionEvidence.find(
    (item) => item.dayKey === normalizedDayKey
  ) || {
    dayKey: normalizedDayKey,
    accumulationEvent: false,
    stealthVolumeEvent: false,
    supportHoldEvent: false,
    failedBreakoutEvent: false,
  };
  const currentEvidence = validSession
    ? {
      dayKey: normalizedDayKey,
      accumulationEvent:
        priorCurrentEvidence.accumulationEvent || accumulationEvent === true,
      stealthVolumeEvent:
        priorCurrentEvidence.stealthVolumeEvent || stealthVolumeEvent === true,
      supportHoldEvent:
        priorCurrentEvidence.supportHoldEvent || supportHoldEvent === true,
      failedBreakoutEvent:
        priorCurrentEvidence.failedBreakoutEvent || failedBreakoutEvent === true,
    }
    : null;
  const sessionEvidence = currentEvidence
    ? [
      ...priorSessionEvidence.filter((item) => item.dayKey !== normalizedDayKey),
      currentEvidence,
    ].sort((a, b) => a.dayKey.localeCompare(b.dayKey)).slice(-MAX_TRACKED_SESSIONS)
    : priorSessionEvidence;
  const nextCount = (name) => sessionEvidence.filter((item) => seenDays.includes(item.dayKey) && item[name]).length;

  return {
    seenDays,
    sessionEvidence,
    sessionCounted: isNewSession,
    lastCountedSessionKey: isNewSession
      ? normalizedDayKey
      : previous.lastCountedSessionKey || priorSeenDays.at(-1) || null,
    accumulationEvents: nextCount("accumulationEvent", previous.accumulationEvents),
    stealthVolumeEvents: nextCount("stealthVolumeEvent", previous.stealthVolumeEvents),
    supportHoldEvents: nextCount("supportHoldEvent", previous.supportHoldEvents),
    failedBreakoutEvents: nextCount("failedBreakoutEvent", previous.failedBreakoutEvents),
  };
}
