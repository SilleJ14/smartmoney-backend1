export function calendarAllowsEntry({
  refreshedAt,
  now = Date.now(),
  coverageComplete,
  eventType,
  eventStart,
  eventEnd,
  maxAgeMinutes = 15,
} = {}) {
  if (!coverageComplete || !refreshedAt) {
    return { ok: false, reason: "CALENDAR_UNAVAILABLE" };
  }
  if (now - Date.parse(refreshedAt) > maxAgeMinutes * 60 * 1000) {
    return { ok: false, reason: "CALENDAR_UNAVAILABLE" };
  }
  if (!eventStart) return { ok: true };
  const start = Date.parse(eventStart);
  const end = Date.parse(eventEnd || eventStart);
  const before = /central|fomc|boe|ecb|rba|boj/i.test(String(eventType || "")) ? 60 : 30;
  const after = /central|fomc|boe|ecb|rba|boj/i.test(String(eventType || "")) ? 60 : 15;
  const windowStart = start - before * 60 * 1000;
  const windowEnd = end + after * 60 * 1000;
  if (now >= windowStart && now <= windowEnd) {
    return { ok: false, reason: "EVENT_WINDOW" };
  }
  return { ok: true };
}
