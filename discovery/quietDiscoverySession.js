import { isUsStockMarketSessionDayKey } from '../utils/usMarketCalendar.js';

// Bootstrap from the previous completed session, never unfinished daily bars.
export function quietDiscoverySessionDay(dateKey, hour, minute) {
  const date = new Date(`${dateKey}T12:00:00Z`);
  if (!Number.isFinite(date.getTime()) || !Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  if (!(hour > 16 || hour === 16 && minute >= 10)) date.setUTCDate(date.getUTCDate() - 1);
  for (let i = 0; i < 10; i++) {
    const key = date.toISOString().slice(0, 10);
    if (isUsStockMarketSessionDayKey(key)) return key;
    date.setUTCDate(date.getUTCDate() - 1);
  }
  return null;
}

export function shouldReuseQuietDiscoveryState(prior, {
  dateKey,
  force = false,
  now = Date.now(),
  maxAgeMs = 15 * 60000,
} = {}) {
  if (force) return false;
  if (!prior || prior.ok !== true || prior.dateKey !== dateKey) return false;
  if (!prior.historicalWarmupRemaining) return true;
  const updatedAt = Date.parse(prior.updatedAt);
  return Number.isFinite(updatedAt) && Number(now) - updatedAt < maxAgeMs;
}
