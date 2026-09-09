const easternDayFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" });
const easternClockFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

// Reuse ICU formatters in quote/scoring hot paths; never reinterpret an ET
// locale string in the server's own timezone. h23 represents midnight as 0.
export function getTodayKeyET(date = new Date()) {
  // Match Date#toLocaleDateString for malformed persisted entry dates. An
  // invalid date must not become today or throw during position protection.
  if (date instanceof Date && !Number.isFinite(date.getTime())) return "Invalid Date";
  return easternDayFormatter.format(date);
}

export function getEasternClock(date = new Date()) {
  const parts = Object.fromEntries(easternClockFormatter.formatToParts(date)
    .filter(part => part.type !== "literal").map(part => [part.type, part.value]));
  return { weekday: parts.weekday, hour: Number(parts.hour), minute: Number(parts.minute) };
}

export function getQuoteTimestampMs(quote = {}) {
  const raw =
    quote.liveQuoteUpdatedAt ||
    quote.quoteFetchedAt ||
    quote.updatedAt ||
    quote.timestamp ||
    null;

  const ms = raw ? new Date(raw).getTime() : 0;
  return Number.isFinite(ms) ? ms : 0;
}
