function nthWeekday(year, monthIndex, weekday, nth) {
  const first = new Date(Date.UTC(year, monthIndex, 1));
  const offset = (weekday - first.getUTCDay() + 7) % 7;
  return 1 + offset + (nth - 1) * 7;
}

export function isUsDaylightSaving(at) {
  const date = new Date(at);
  const year = date.getUTCFullYear();
  const start = Date.UTC(year, 2, nthWeekday(year, 2, 0, 2), 7);
  const end = Date.UTC(year, 10, nthWeekday(year, 10, 0, 1), 6);
  return at >= start && at < end;
}

export function weeklyCloseUtcMs(at) {
  return isUsDaylightSaving(at) ? 21 * 60 * 60 * 1000 : 22 * 60 * 60 * 1000;
}

export function forexMarketState(now = Date.now(), holidays = []) {
  const date = new Date(now);
  const day = date.getUTCDay();
  const closeMs = weeklyCloseUtcMs(now);
  const dayMs = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const fridayClose = dayMs + closeMs;
  const minutesToClose = (fridayClose - now) / 60000;
  const isoDay = date.toISOString().slice(0, 10);
  if (holidays.includes(isoDay)) {
    return { open: false, reason: "HOLIDAY", minutesToWeeklyClose: null };
  }
  if (day === 6) return { open: false, reason: "WEEKEND", minutesToWeeklyClose: null };
  if (day === 0 && (now - dayMs) < closeMs) return { open: false, reason: "WEEKEND", minutesToWeeklyClose: null };
  if (day === 5 && minutesToClose <= 0) return { open: false, reason: "WEEKLY_CLOSE", minutesToWeeklyClose: minutesToClose };
  return {
    open: true,
    reason: "OPEN",
    minutesToWeeklyClose: day === 5 ? minutesToClose : null,
    tooCloseToWeeklyClose: day === 5 && minutesToClose < 30,
  };
}

export function mustCloseBeforeEventOrWeekend({ now, eventWindowStart, maxHoldHours = 8 }) {
  const session = forexMarketState(now);
  const holdEnd = now + maxHoldHours * 3600 * 1000;
  const weekly = session.minutesToWeeklyClose != null ? now + session.minutesToWeeklyClose * 60000 : null;
  const event = eventWindowStart ? Date.parse(eventWindowStart) : null;
  const deadlines = [weekly, event].filter((value) => Number.isFinite(value));
  const closeBy = deadlines.length ? Math.min(...deadlines) : weekly;
  if (!closeBy) return { ok: true, closeBy: null };
  const remainingMinutes = (closeBy - now) / 60000;
  if (remainingMinutes < 15) return { ok: false, reason: "MANDATORY_CLOSE_TOO_SOON", closeBy };
  if (holdEnd > closeBy - 30 * 60000) return { ok: false, reason: "HOLD_PAST_MANDATORY_CLOSE", closeBy };
  return { ok: true, closeBy };
}
