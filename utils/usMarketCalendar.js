const marketHolidayCache = new Map();

function dayKeyFromUtcDate(date) {
  return date.toISOString().slice(0, 10);
}

function observedFixedHoliday(year, monthIndex, day) {
  const holiday = new Date(Date.UTC(year, monthIndex, day));
  const weekday = holiday.getUTCDay();
  if (weekday === 6) holiday.setUTCDate(holiday.getUTCDate() - 1);
  if (weekday === 0) holiday.setUTCDate(holiday.getUTCDate() + 1);
  return dayKeyFromUtcDate(holiday);
}

function nthWeekday(year, monthIndex, weekday, occurrence) {
  const date = new Date(Date.UTC(year, monthIndex, 1));
  const offset = (weekday - date.getUTCDay() + 7) % 7;
  date.setUTCDate(1 + offset + (occurrence - 1) * 7);
  return dayKeyFromUtcDate(date);
}

function lastWeekday(year, monthIndex, weekday) {
  const date = new Date(Date.UTC(year, monthIndex + 1, 0));
  const offset = (date.getUTCDay() - weekday + 7) % 7;
  date.setUTCDate(date.getUTCDate() - offset);
  return dayKeyFromUtcDate(date);
}

function easterSundayUtc(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

function marketHolidaysForYear(year) {
  if (marketHolidayCache.has(year)) return marketHolidayCache.get(year);
  const holidays = new Set([
    observedFixedHoliday(year, 0, 1),
    nthWeekday(year, 0, 1, 3),
    nthWeekday(year, 1, 1, 3),
    lastWeekday(year, 4, 1),
    observedFixedHoliday(year, 5, 19),
    observedFixedHoliday(year, 6, 4),
    nthWeekday(year, 8, 1, 1),
    nthWeekday(year, 10, 4, 4),
    observedFixedHoliday(year, 11, 25),
  ]);
  const goodFriday = easterSundayUtc(year);
  goodFriday.setUTCDate(goodFriday.getUTCDate() - 2);
  holidays.add(dayKeyFromUtcDate(goodFriday));

  // New Year's Day can be observed on December 31 of the prior year.
  const nextNewYearObserved = observedFixedHoliday(year + 1, 0, 1);
  if (nextNewYearObserved.startsWith(`${year}-`)) {
    holidays.add(nextNewYearObserved);
  }
  marketHolidayCache.set(year, holidays);
  return holidays;
}

export function parseMarketDayKey(dayKey) {
  const match = String(dayKey || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) return null;
  return { year, month, day, date };
}

export function isUsStockMarketSessionDayKey(dayKey) {
  const parsed = parseMarketDayKey(dayKey);
  if (!parsed) return false;
  const weekday = parsed.date.getUTCDay();
  if (weekday === 0 || weekday === 6) return false;
  return !marketHolidaysForYear(parsed.year).has(String(dayKey));
}

export function addUsStockMarketSessionDays(parts, numberOfDays) {
  const cursor = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  let remaining = Math.max(0, Number(numberOfDays || 0));
  while (remaining > 0) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    if (isUsStockMarketSessionDayKey(dayKeyFromUtcDate(cursor))) {
      remaining -= 1;
    }
  }
  return {
    year: cursor.getUTCFullYear(),
    month: cursor.getUTCMonth() + 1,
    day: cursor.getUTCDate(),
  };
}

