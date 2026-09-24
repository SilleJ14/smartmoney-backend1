// Bounded observed NAV history, separate from Alpaca and trading authorization.
export function recordForexAccountHistory(ledger, account, now) {
  const value = Number(account?.NAV);
  if (!account?.id || !Number.isFinite(value) || value <= 0 || !Number.isFinite(now)) return [];
  const same = ledger.forexAccountHistory?.accountId === account.id && ledger.forexAccountHistory?.currency === account.currency;
  const points = (same && Array.isArray(ledger.forexAccountHistory.points) ? ledger.forexAccountHistory.points : [])
    .filter(p => Number.isFinite(p.timestamp) && Number.isFinite(p.value) && p.value > 0 && p.timestamp >= now - 86400000 && p.timestamp <= now);
  const point = { timestamp: now, value };
  // Keep the newest observed NAV in each minute; never synthesize movement.
  if (points.length && Math.floor(points.at(-1).timestamp / 60000) === Math.floor(now / 60000)) points[points.length - 1] = point;
  else points.push(point);
  ledger.forexAccountHistory = { accountId: account.id, currency: account.currency, points: points.slice(-1440) };
  return ledger.forexAccountHistory.points;
}
