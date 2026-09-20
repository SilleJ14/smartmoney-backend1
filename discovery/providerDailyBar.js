import { getTodayKeyET } from "../utils/time.js";

function utcDateKey(time) {
  return new Date(time).toISOString().slice(0, 10);
}

function explicitDayKey(raw) {
  const text = String(raw);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

// Daily bars have a provider date, never a download/receipt date. Both ISO
// Alpaca bars and epoch Polygon bars normalize through this boundary.
export function providerDailyBar(symbol, bar = {}, { now = Date.now() } = {}) {
  const raw = bar.t ?? bar.d ?? bar.date;
  if (raw === null || raw === undefined || raw === "") return null;
  const numeric = Number(raw);
  const time = Number.isFinite(numeric) ? (numeric < 1e11 ? numeric * 1000 : numeric) : Date.parse(String(raw));
  if (!Number.isFinite(time) || time > Number(now) + 5000) return null;
  const [o, h, l, c, v] = [bar.o ?? bar.open, bar.h ?? bar.high, bar.l ?? bar.low, bar.c ?? bar.close, bar.v ?? bar.volume].map(Number);
  if (![o, h, l, c, v].every(Number.isFinite) || Math.min(o, h, l, c) <= 0 || v < 0 ||
      h < Math.max(o, c) || l > Math.min(o, c) || h < l) return null;
  const utcDate = utcDateKey(time);
  const etDate = getTodayKeyET(new Date(time));
  const d = explicitDayKey(raw) || etDate;
  return { s: symbol, d, utcDate, etDate, o, h, l, c, v, t: new Date(time).toISOString() };
}

export function providerDailyBarMatchesSession(bar, dateKey) {
  if (!bar || !dateKey) return false;
  return bar.d === dateKey || bar.etDate === dateKey || bar.utcDate === dateKey;
}
