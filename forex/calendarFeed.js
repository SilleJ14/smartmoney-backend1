import { FOREX_SPEC } from "./forexSpec.js";
import { calendarAllowsEntry } from "./calendarService.js";
import fs from "node:fs";

export function defaultCalendarSnapshot() {
  return {
    source: "none",
    refreshedAt: null,
    coverageComplete: false,
    events: [],
    qualityStatus: "MISSING",
  };
}

// Feed adapters write this normalized snapshot atomically. Missing/invalid feeds fail closed.
export function loadCalendarSnapshot(filePath) {
  if (!filePath) return defaultCalendarSnapshot();
  try {
    const snapshot = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return snapshot && Array.isArray(snapshot.events) ? snapshot : defaultCalendarSnapshot();
  } catch {
    return defaultCalendarSnapshot();
  }
}

export function calendarForDecision(snapshot = defaultCalendarSnapshot(), { now = Date.now(), instrument, eventType, eventStart, eventEnd } = {}) {
  if (!snapshot || snapshot.coverageComplete !== true) {
    return { ok: false, reason: "CALENDAR_UNAVAILABLE" };
  }
  const base = {
    refreshedAt: snapshot.refreshedAt,
    now,
    coverageComplete: snapshot.coverageComplete,
    eventType,
    eventStart,
    eventEnd,
    maxAgeMinutes: FOREX_SPEC.calendarMaxAgeMinutes,
  };
  const freshness = calendarAllowsEntry(base);
  if (!freshness.ok) return freshness;
  if (!Array.isArray(snapshot.events)) return { ok: false, reason: "CALENDAR_UNAVAILABLE" };
  const currencies = String(instrument || "").split(/[_/]/);
  for (const event of snapshot.events) {
    if (!event || !event.start || !event.currency || !event.type) {
      return { ok: false, reason: "CALENDAR_UNAVAILABLE" };
    }
    // Validate even unrelated rows: malformed coverage must not pass as a clean feed.
    const gate = calendarAllowsEntry({ ...base, eventType: event.type, eventStart: event.start, eventEnd: event.end });
    if (gate.reason === "CALENDAR_UNAVAILABLE") return gate;
    if ((!instrument || event.currency === "ALL" || currencies.includes(event.currency)) && !gate.ok) return gate;
  }
  return { ok: true };
}
