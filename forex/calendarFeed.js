import { FOREX_SPEC } from "./forexSpec.js";
import { calendarAllowsEntry } from "./calendarService.js";

export function defaultCalendarSnapshot() {
  return {
    source: "none",
    refreshedAt: null,
    coverageComplete: false,
    events: [],
    qualityStatus: "MISSING",
  };
}

export function calendarForDecision(snapshot = defaultCalendarSnapshot(), { now, eventType, eventStart, eventEnd } = {}) {
  if (!snapshot || snapshot.coverageComplete !== true) {
    return { ok: false, reason: "CALENDAR_UNAVAILABLE" };
  }
  return calendarAllowsEntry({
    refreshedAt: snapshot.refreshedAt,
    now,
    coverageComplete: snapshot.coverageComplete,
    eventType,
    eventStart,
    eventEnd,
    maxAgeMinutes: FOREX_SPEC.calendarMaxAgeMinutes,
  });
}
